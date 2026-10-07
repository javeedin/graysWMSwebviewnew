/* Finance Lens — Board packs › Distribution (FL.packTrack): who received each board pack and what happened to it.
   Every e-mail sent from the app is recorded in APEX (apex_sql/95_finance_pack_tracking.sql, tables created by the page):
     WMS_FIN_PACK_SENDS  one row per send (document ID, pack, period, subject, how, from which mailbox, by whom, fingerprint)
     WMS_FIN_PACK_RCPT   one row per recipient copy (token, To / Cc / Bcc, sent / failed, delivered, bounced, read receipt,
                         opens of the tracking picture, "I have received it" confirmation)
   Tracking (per send, chosen in the e-mail dialog): each recipient gets their own copy with a 1×1 picture …/pack/px/<token>
   and a button …/pack/ack/<token> (a page whose confirmation is a POST, so mail scanners that open links do not confirm).
   Read / delivery receipts and bounces come back to the sending mailbox; Check receipts reads them (host finMailReceipts:
   Microsoft 365 through Graph Mail.ReadBasic, or the Outlook Inbox) and writes them here. Times are kept in database time
   and shown in this PC's time (T.offset from SYSDATE). */
(function () {
    var T = FL.packTrack = { rows: null, sends: null, f: FL.ls('pack.trk.f', { q: '', st: '', days: 90 }) };
    var A = function () { return FL.apexStore; };
    var lit = function (s) { return s == null || s === '' ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'"; };
    var cut = function (s, n) { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) : s; };

    T.base = function () { return A().URL.replace(/\/ai$/, '/'); };
    T.pixelUrl = function (tok) { return T.base() + 'pack/px/' + tok; };
    T.ackUrl = function (tok) { return T.base() + 'pack/ack/' + tok; };
    T.token = function () { var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); };

    var DDL = {
        WMS_FIN_PACK_SENDS: 'CREATE TABLE wms_fin_pack_sends (send_id VARCHAR2(40) NOT NULL, doc_id VARCHAR2(40), pack_id VARCHAR2(60), pack_name VARCHAR2(200), title VARCHAR2(300), company VARCHAR2(200), period VARCHAR2(40), ' +
            'ledgers VARCHAR2(400), subject VARCHAR2(400), method VARCHAR2(20), mailbox VARCHAR2(320), app_user VARCHAR2(100), machine VARCHAR2(100), sent_at DATE DEFAULT SYSDATE, file_name VARCHAR2(300), sha256 VARCHAR2(64), ' +
            "tracked CHAR(1) DEFAULT 'N', receipts CHAR(1) DEFAULT 'N', recipients NUMBER, note VARCHAR2(1000), CONSTRAINT wms_fin_pack_sends_pk PRIMARY KEY (send_id))",
        WMS_FIN_PACK_RCPT: 'CREATE TABLE wms_fin_pack_rcpt (token VARCHAR2(64) NOT NULL, send_id VARCHAR2(40) NOT NULL, email VARCHAR2(320) NOT NULL, kind VARCHAR2(4), status VARCHAR2(20), error_text VARCHAR2(1000), ' +
            'sent_at DATE, delivered_at DATE, bounced_at DATE, bounce_text VARCHAR2(1000), read_at DATE, not_read_at DATE, opens NUMBER DEFAULT 0, first_open DATE, last_open DATE, last_agent VARCHAR2(400), ' +
            'ack_at DATE, ack_agent VARCHAR2(400), CONSTRAINT wms_fin_pack_rcpt_pk PRIMARY KEY (token))',
        WMS_FIN_PACK_GIF: 'CREATE TABLE wms_fin_pack_gif (id NUMBER PRIMARY KEY, gif BLOB)'
    };
    /** Creates the tables that are missing (once per session) */
    T.ensure = function () {
        if (T._ens) return T._ens;
        T._ens = A().read("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_FIN_PACK_SENDS','WMS_FIN_PACK_RCPT','WMS_FIN_PACK_GIF')").then(function (rows) {
            var have = {}; rows.forEach(function (r) { have[r.TABLE_NAME] = 1; });
            var chain = Promise.resolve();
            Object.keys(DDL).forEach(function (t) { if (!have[t]) chain = chain.then(function () { return A().write(DDL[t]); }); });
            if (!have.WMS_FIN_PACK_RCPT) chain = chain.then(function () { return A().write('CREATE INDEX wms_fin_pack_rcpt_send ON wms_fin_pack_rcpt (send_id)'); }).then(function () { return A().write('CREATE INDEX wms_fin_pack_rcpt_mail ON wms_fin_pack_rcpt (email)'); });
            if (!have.WMS_FIN_PACK_GIF) chain = chain.then(function () { return A().write("INSERT INTO wms_fin_pack_gif (id, gif) VALUES (1, TO_BLOB(HEXTORAW('47494638396101000100800000FFFFFF00000021F90401000000002C00000000010001000002024401003B')))"); });
            // the e-mail as sent (added later — older tables get the column)
            chain = chain.then(function () { return A().read("SELECT column_name FROM user_tab_columns WHERE table_name = 'WMS_FIN_PACK_SENDS' AND column_name = 'EMAIL_HTML'"); })
                .then(function (c) { if (!c.length) return A().write('ALTER TABLE wms_fin_pack_sends ADD (email_html CLOB)'); });
            return chain;
        }).catch(function (e) { T._ens = null; throw e; });
        return T._ens;
    };

    // ── the public links (procedures + ORDS endpoints) ──
    var PX = "CREATE OR REPLACE PROCEDURE wms_fin_pack_px (p_tok IN VARCHAR2) AS v_gif BLOB; v_ua VARCHAR2(400); BEGIN " +
        "BEGIN v_ua := SUBSTR(OWA_UTIL.get_cgi_env('HTTP_USER_AGENT'), 1, 400); EXCEPTION WHEN OTHERS THEN v_ua := NULL; END; " +
        "IF p_tok IS NOT NULL AND LENGTH(p_tok) BETWEEN 16 AND 64 THEN UPDATE wms_fin_pack_rcpt SET opens = NVL(opens, 0) + 1, first_open = NVL(first_open, SYSDATE), last_open = SYSDATE, last_agent = v_ua WHERE token = p_tok; COMMIT; END IF; " +
        "SELECT gif INTO v_gif FROM wms_fin_pack_gif WHERE id = 1; OWA_UTIL.mime_header('image/gif', FALSE); HTP.p('Cache-Control: no-store, no-cache, must-revalidate, max-age=0'); HTP.p('Pragma: no-cache'); OWA_UTIL.http_header_close; " +
        "WPG_DOCLOAD.download_file(v_gif); END wms_fin_pack_px;";
    var ACK = "CREATE OR REPLACE PROCEDURE wms_fin_pack_ack (p_tok IN VARCHAR2, p_post IN VARCHAR2) AS v_email VARCHAR2(320); v_title VARCHAR2(300); v_company VARCHAR2(200); v_period VARCHAR2(40); v_doc VARCHAR2(40); v_ack DATE; v_ua VARCHAR2(400); " +
        "PROCEDURE page (p_body IN VARCHAR2) IS BEGIN OWA_UTIL.mime_header('text/html', FALSE, 'UTF-8'); HTP.p('Cache-Control: no-store'); OWA_UTIL.http_header_close; " +
        "HTP.p('<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Board pack</title><style>body{margin:0;font:15px/1.5 \"Segoe UI\",Arial,sans-serif;background:#eef1f7;color:#0f172a}.c{max-width:520px;margin:8vh auto;background:#fff;border-radius:14px;padding:30px 34px;box-shadow:0 10px 30px rgba(15,23,42,.1)}h1{font-size:21px;margin:0 0 6px}.m{color:#64748b;font-size:13px}button{margin-top:18px;background:#1d4ed8;color:#fff;border:0;border-radius:9px;padding:12px 20px;font:inherit;font-weight:700;cursor:pointer}.ok{color:#15803d;font-weight:700;font-size:17px}.f{margin-top:22px;font-size:12px;color:#94a3b8}</style></head><body><div class=\"c\">'); " +
        "HTP.p(p_body); HTP.p('<div class=\"f\">Finance Lens · Powered by Fusion Client</div></div></body></html>'); END; " +
        "BEGIN BEGIN v_ua := SUBSTR(OWA_UTIL.get_cgi_env('HTTP_USER_AGENT'), 1, 400); EXCEPTION WHEN OTHERS THEN v_ua := NULL; END; " +
        "BEGIN SELECT r.email, s.title, s.company, s.period, s.doc_id, r.ack_at INTO v_email, v_title, v_company, v_period, v_doc, v_ack FROM wms_fin_pack_rcpt r JOIN wms_fin_pack_sends s ON s.send_id = r.send_id WHERE r.token = p_tok; " +
        "EXCEPTION WHEN NO_DATA_FOUND THEN page('<h1>This link is not valid</h1><p class=\"m\">It may have been copied incompletely. Please use the button in the e-mail.</p>'); RETURN; END; " +
        "IF p_post = 'Y' AND v_ack IS NULL THEN UPDATE wms_fin_pack_rcpt SET ack_at = SYSDATE, ack_agent = v_ua WHERE token = p_tok; COMMIT; v_ack := SYSDATE; END IF; " +
        "IF v_ack IS NULL THEN page('<div class=\"m\">' || HTF.escape_sc(v_company) || '</div><h1>' || HTF.escape_sc(v_title) || ' · ' || HTF.escape_sc(v_period) || '</h1><p>Please confirm that you (' || HTF.escape_sc(v_email) || ') have received this board pack.</p><p class=\"m\">Document ' || HTF.escape_sc(v_doc) || '</p><form method=\"post\"><button type=\"submit\">I have received the board pack</button></form>'); " +
        "ELSE page('<div class=\"m\">' || HTF.escape_sc(v_company) || '</div><h1>' || HTF.escape_sc(v_title) || ' · ' || HTF.escape_sc(v_period) || '</h1><p class=\"ok\">&#10003; Thank you — receipt confirmed</p><p class=\"m\">' || HTF.escape_sc(v_email) || ' · ' || TO_CHAR(v_ack, 'DD Mon YYYY HH24:MI') || ' · document ' || HTF.escape_sc(v_doc) || '</p>'); END IF; END wms_fin_pack_ack;";
    var ORDS_SETUP = "DECLARE v_module VARCHAR2(200); BEGIN SELECT name INTO v_module FROM user_ords_modules WHERE UPPER(uri_prefix) LIKE '%WAREHOUSEMANAGEMENT%' AND ROWNUM = 1; " +
        "ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => 'pack/px/:tok'); ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'pack/px/:tok', p_method => 'GET', p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_fin_pack_px(:tok); END;'); " +
        "ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => 'pack/ack/:tok'); ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'pack/ack/:tok', p_method => 'GET', p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_fin_pack_ack(:tok, ''N''); END;'); " +
        "ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'pack/ack/:tok', p_method => 'POST', p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_fin_pack_ack(:tok, ''Y''); END;'); COMMIT; END;";
    /** Is the confirmation page answering? (a made-up token must say "not valid") */
    T.check = function () {
        return FL.host('executeGet', { fullUrl: T.ackUrl('0000000000000000') }, 30000).then(function (d) {
            var txt = typeof d === 'string' ? d : JSON.stringify(d || '');
            T.linksOk = /not valid/i.test(txt); return T.linksOk;
        }).catch(function () { T.linksOk = false; return false; });
    };
    T.setup = function () {
        var bid = FL.busy.start('Setting up the tracking links in APEX…');
        return T.ensure().then(function () { return A().write(PX); }).then(function () { return A().write(ACK); }).then(function () { return A().write(ORDS_SETUP); })
            .then(T.check).then(function (ok) {
                FL.busy.end(bid, ok ? null : 'The links do not answer yet');
                FL.toast(ok ? 'Tracking links are working' : 'Created, but the confirmation page does not answer — run apex_sql/95_finance_pack_tracking.sql in SQL Developer', ok ? 'ok' : 'err');
                return ok;
            }).catch(function (e) { FL.busy.end(bid, String(e && e.message || e)); FL.toast('Could not set up the links here (' + (e && e.message || e) + ') — run apex_sql/95_finance_pack_tracking.sql in SQL Developer', 'err'); return false; });
    };

    // ── database clock: times are written with SYSDATE; this PC shows them in its own time ──
    T.clock = function () {
        if (T._clk) return T._clk;
        T._clk = A().read("SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS NOW_ FROM dual").then(function (r) {
            var db = Date.parse(r[0].NOW_ + 'Z'), here = Date.now() - new Date().getTimezoneOffset() * 60000;   // both as "wall clock read as UTC"
            T.offset = Math.round((here - db) / 900000) * 900000;   // PC local wall time − DB wall time, to 15 minutes
            return T.offset;
        }).catch(function () { T.offset = 0; return 0; });
        return T._clk;
    };
    var dbDate = function (s) { if (!s) return null; var t = Date.parse(s + 'Z'); return isNaN(t) ? null : new Date(t + (T.offset || 0) + new Date().getTimezoneOffset() * 60000); };   // DB wall time → a local Date
    var toDb = function (d) { var w = new Date(d.getTime() - d.getTimezoneOffset() * 60000 - (T.offset || 0)); return "TO_DATE('" + w.toISOString().slice(0, 19).replace('T', ' ') + "', 'YYYY-MM-DD HH24:MI:SS')"; };
    var when = function (d) { if (!d) return ''; var s = (Date.now() - d.getTime()) / 1000; return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
    var full = function (d) { return d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };

    // ── recording a send ──
    /** send = {sendId, docId, pack, period, ledgers, subject, method, mailbox, file, sha, tracked, receipts, note}; rcpts = [{token, email, kind}] */
    T.record = function (send, rcpts) {
        var p = send.pack || {};
        return T.ensure().then(function () {
            return A().write('INSERT INTO wms_fin_pack_sends (send_id, doc_id, pack_id, pack_name, title, company, period, ledgers, subject, method, mailbox, app_user, machine, sent_at, file_name, sha256, tracked, receipts, recipients, note) VALUES (' +
                [lit(send.sendId), lit(send.docId), lit(p.id), lit(cut(p.name, 200)), lit(cut(p.title || p.name, 300)), lit(cut(p.company, 200)), lit(cut(send.period, 40)), lit(cut(send.ledgers, 400)), lit(cut(send.subject, 400)),
                    lit(send.method), lit(cut(send.mailbox, 320)), lit(cut((FL.who && FL.who.user) || '', 100)), lit(cut(send.machine || '', 100)), 'SYSDATE', lit(cut(send.file, 300)), lit(send.sha), lit(send.tracked ? 'Y' : 'N'), lit(send.receipts ? 'Y' : 'N'), rcpts.length, lit(cut(send.note, 1000))].join(', ') + ')');
        }).then(function () {
            var chunks = []; for (var i = 0; i < rcpts.length; i += 30) chunks.push(rcpts.slice(i, i + 30));
            return chunks.reduce(function (pr, ch) {
                return pr.then(function () {
                    return A().write('INSERT INTO wms_fin_pack_rcpt (token, send_id, email, kind, status, opens) ' + ch.map(function (r) { return 'SELECT ' + lit(r.token) + ', ' + lit(send.sendId) + ', ' + lit(cut(r.email, 320)) + ', ' + lit(r.kind) + ", 'PENDING', 0 FROM dual"; }).join(' UNION ALL '));
                });
            }, Promise.resolve());
        });
    };
    var clobOf = function (t) { var p = []; for (var j = 0; j < t.length; j += 1000) p.push('TO_CLOB(' + lit(t.slice(j, j + 1000)) + ')'); return p.join(' || ') || 'NULL'; };
    /** Keeps the e-mail text of a send (CLOB written in 20,000-character pieces) */
    T.saveBody = function (sendId, html) {
        var ch = []; for (var i = 0; i < html.length; i += 20000) ch.push(html.slice(i, i + 20000));
        return ch.reduce(function (p, c, k) { return p.then(function () { return A().write('UPDATE wms_fin_pack_sends SET email_html = ' + (k ? 'email_html || ' : '') + clobOf(c) + ' WHERE send_id = ' + lit(sendId)); }); }, Promise.resolve());
    };
    /** A CLOB of the sends table, read in 4,000-character pieces */
    T.clob = function (sendId, col) {
        return A().read('SELECT LENGTH(' + col + ') AS n FROM wms_fin_pack_sends WHERE send_id = ' + lit(sendId), 1).then(function (r) {
            var len = r.length ? +r[0].N || 0 : 0, cols = [];
            for (var i = 1; i <= len; i += 4000) cols.push('TO_CHAR(SUBSTR(' + col + ', ' + i + ', 4000)) AS p' + cols.length);
            var groups = []; for (var g = 0; g < cols.length; g += 20) groups.push(cols.slice(g, g + 20));
            return Promise.all(groups.map(function (gr) { return A().read('SELECT ' + gr.join(', ') + ' FROM wms_fin_pack_sends WHERE send_id = ' + lit(sendId), 1); })).then(function (parts) {
                var t = ''; parts.forEach(function (rows, gi) { groups[gi].forEach(function (_, j) { t += (rows[0] || {})['P' + (gi * 20 + j)] || ''; }); }); return t;
            });
        });
    };
    /** After the e-mail of one copy: SENT / DRAFT / FAILED */
    T.mark = function (tokens, status, err) {
        if (!tokens.length) return Promise.resolve();
        return A().write('UPDATE wms_fin_pack_rcpt SET status = ' + lit(status) + ', sent_at = SYSDATE, error_text = ' + lit(cut(err, 1000)) + ' WHERE token IN (' + tokens.map(lit).join(',') + ')').catch(function (e) { console.warn('[Distribution] mark', e); });
    };

    // ── reading ──
    var D8 = function (c) { return "TO_CHAR(" + c + ", 'YYYY-MM-DD\"T\"HH24:MI:SS') AS " + c.toUpperCase(); };
    T.load = function () {
        var days = +T.f.days || 90;
        return Promise.all([T.ensure(), T.clock()]).then(function () {
            return Promise.all([
                A().read('SELECT send_id, doc_id, pack_id, pack_name, title, company, period, ledgers, subject, method, mailbox, app_user, ' + D8('sent_at') + ', file_name, sha256, tracked, receipts, recipients FROM wms_fin_pack_sends WHERE sent_at >= SYSDATE - ' + days + ' ORDER BY sent_at DESC', 1000),
                A().read('SELECT r.token, r.send_id, r.email, r.kind, r.status, r.error_text, ' + ['r.sent_at', 'r.delivered_at', 'r.bounced_at', 'r.read_at', 'r.not_read_at', 'r.first_open', 'r.last_open', 'r.ack_at'].map(function (c) { return "TO_CHAR(" + c + ", 'YYYY-MM-DD\"T\"HH24:MI:SS') AS " + c.slice(2).toUpperCase(); }).join(', ') +
                    ', r.bounce_text, r.opens, r.last_agent FROM wms_fin_pack_rcpt r JOIN wms_fin_pack_sends s ON s.send_id = r.send_id WHERE s.sent_at >= SYSDATE - ' + days, 5000)
            ]);
        }).then(function (res) {
            var sends = {}; res[0].forEach(function (s) { s.at = dbDate(s.SENT_AT); s.rc = []; sends[s.SEND_ID] = s; });
            res[1].forEach(function (r) {
                ['SENT_AT', 'DELIVERED_AT', 'BOUNCED_AT', 'READ_AT', 'NOT_READ_AT', 'FIRST_OPEN', 'LAST_OPEN', 'ACK_AT'].forEach(function (k) { r[k] = dbDate(r[k]); });
                r.state = T.state(r); var s = sends[r.SEND_ID]; if (s) { r.send = s; s.rc.push(r); }
            });
            T.sends = res[0]; T.rows = res[1].filter(function (r) { return r.send; });
            return T;
        });
    };
    /** The furthest a copy got: confirmed > read > opened > delivered > sent; bounced / failed win */
    T.STATES = {
        FAILED: { label: 'Not sent', cls: 'bad', icon: 'fa-circle-xmark' }, BOUNCED: { label: 'Bounced', cls: 'bad', icon: 'fa-triangle-exclamation' },
        PENDING: { label: 'Sending…', cls: '', icon: 'fa-hourglass-half' }, DRAFT: { label: 'Opened in Outlook', cls: '', icon: 'fa-pen-to-square' },
        SENT: { label: 'Sent', cls: '', icon: 'fa-paper-plane' }, DELIVERED: { label: 'Delivered', cls: 'info', icon: 'fa-inbox' },
        OPENED: { label: 'Opened', cls: 'info', icon: 'fa-envelope-open' }, READ: { label: 'Read', cls: 'good', icon: 'fa-eye' }, ACK: { label: 'Confirmed', cls: 'good', icon: 'fa-circle-check' }
    };
    T.state = function (r) {
        if (r.STATUS === 'FAILED') return 'FAILED'; if (r.BOUNCED_AT) return 'BOUNCED'; if (r.ACK_AT) return 'ACK'; if (r.READ_AT) return 'READ';
        if (+r.OPENS > 0) return 'OPENED'; if (r.DELIVERED_AT) return 'DELIVERED'; if (r.STATUS === 'DRAFT') return 'DRAFT'; if (r.STATUS === 'PENDING') return 'PENDING'; return 'SENT';
    };
    /** A hint when an "open" may be a machine: within 20 s of sending, or a known image proxy */
    T.openHint = function (r) {
        var a = String(r.LAST_AGENT || '');
        if (/GoogleImageProxy/i.test(a)) return 'opened in Gmail (Google loads pictures through its proxy)';
        if (r.FIRST_OPEN && r.SENT_AT && r.FIRST_OPEN - r.SENT_AT < 20000) return 'opened within seconds of sending — may be a mail scanner, not a person';
        return a ? 'last opened with: ' + a.slice(0, 140) : '';
    };

    // ── receipts from the mailbox ──
    T.receipts = function () {
        var open = (T.rows || []).filter(function (r) { return r.STATUS !== 'FAILED' && (!r.READ_AT || !r.DELIVERED_AT) && !r.BOUNCED_AT && r.send.SUBJECT; });
        if (!open.length) { FL.toast('Nothing waiting for a receipt', 'info'); return Promise.resolve(); }
        var methods = {}; open.forEach(function (r) { if (r.send.METHOD !== 'SMTP') methods[r.send.METHOD] = 1; });
        if (!Object.keys(methods).length) { FL.toast('These packs went by SMTP — read receipts arrive in that mailbox; opens and confirmations are tracked here', 'info'); return Promise.resolve(); }
        var since = new Date(Math.min.apply(null, open.map(function (r) { return r.send.at ? r.send.at.getTime() : Date.now(); })) - 3600000);
        var subjects = Object.keys(open.reduce(function (o, r) { o[r.send.SUBJECT] = 1; return o; }, {})), addrs = Object.keys(open.reduce(function (o, r) { o[r.EMAIL.toLowerCase()] = 1; return o; }, {}));
        var bid = FL.busy.start('Reading receipts from the mailbox…');
        return Object.keys(methods).reduce(function (pr, m) {
            return pr.then(function (acc) {
                return FL.call('finMailReceipts', { method: m, since: since.toISOString(), subjects: subjects, addresses: addrs }, 300000).then(function (r) {
                    if (!r.ok) { FL.toast(r.error || 'Receipts not read', 'err'); return acc; }
                    return acc.concat((r.receipts || []).map(function (x) { x.via = r.mailbox; return x; }));
                });
            });
        }, Promise.resolve([])).then(function (found) {
            // each receipt → the latest copy to that address with that subject sent before the receipt
            var sqls = [], n = 0;
            found.forEach(function (x) {
                var at = new Date(x.At || x.at || Date.now()), em = String(x.Email || x.email || '').toLowerCase(), subj = x.Subject || x.subject, kind = x.Kind || x.kind;
                var cand = open.filter(function (r) { return r.EMAIL.toLowerCase() === em && r.send.SUBJECT === subj && (!r.send.at || r.send.at.getTime() <= at.getTime() + 60000); })
                    .sort(function (a, b) { return b.send.at - a.send.at; })[0];
                if (!cand) return;
                var col = { READ: 'read_at', NOT_READ: 'not_read_at', DELIVERED: 'delivered_at', BOUNCED: 'bounced_at' }[kind]; if (!col) return;
                n++;
                sqls.push('UPDATE wms_fin_pack_rcpt SET ' + col + ' = NVL(' + col + ', ' + toDb(at) + ')' + (kind === 'BOUNCED' ? ', bounce_text = ' + lit(cut(x.Detail || x.detail, 1000)) : '') + (kind === 'READ' ? ', delivered_at = NVL(delivered_at, ' + toDb(at) + ')' : '') + ' WHERE token = ' + lit(cand.TOKEN));
            });
            return sqls.reduce(function (pr, s) { return pr.then(function () { return A().write(s); }); }, Promise.resolve()).then(function () {
                FL.busy.end(bid); FL.toast(found.length ? n + ' receipt' + (n === 1 ? '' : 's') + ' matched (' + found.length + ' found)' : 'No new receipts in the mailbox', 'ok');
            });
        }).catch(function (e) { FL.busy.end(bid, String(e && e.message || e)); FL.toast(String(e && e.message || e), 'err'); });
    };

    // ── the Distribution tab ──
    T.render = function (body) {
        T.body = body;
        if (T.mode === 'new') return FL.packDist.render(body);
        if (T.detailId) return T.renderDetail(body, T.detailId);
        body.innerHTML = '<div class="card"><div class="row" style="gap:8px;flex-wrap:wrap"><h3 style="margin:0"><i class="fa-solid fa-paper-plane"></i> Distribution</h3><span class="sm muted">every board pack e-mailed from the app — to whom, when, and what happened to it</span><span class="grow"></span>' +
            '<span id="pt-links" class="sm"></span><button class="btn primary" id="pt-new" title="Choose a template, period, ledgers and people, preview it and send it — kept as a record you can open later"><i class="fa-solid fa-plus"></i> New distribution</button><button class="btn" id="pt-rc" title="Read the read / delivery receipts and bounces that came back to the sending mailbox (Microsoft 365 or Outlook)"><i class="fa-solid fa-envelope-circle-check"></i> Check receipts</button><button class="btn" id="pt-ref"><i class="fa-solid fa-rotate"></i></button></div>' +
            '<div class="row pt-filters" style="gap:8px;margin-top:8px;flex-wrap:wrap"><input id="pt-q" type="search" placeholder="Search a person, pack, document…" value="' + esc(T.f.q || '') + '" style="min-width:260px">' +
            '<select id="pt-days" class="sm">' + [[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year'], [3650, 'Everything']].map(function (o) { return '<option value="' + o[0] + '"' + (+T.f.days === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
            '<div class="seg sm" id="pt-view">' + [['sends', 'By send'], ['people', 'By person']].map(function (v) { return '<button data-v="' + v[0] + '"' + ((T.f.view || 'sends') === v[0] ? ' class="on"' : '') + '>' + v[1] + '</button>'; }).join('') + '</div><span id="pt-chips"></span></div></div>' +
            '<div id="pt-kpis" class="pt-kpis"></div><div id="pt-main"><div class="card muted">Loading…</div></div>';
        $('pt-q').oninput = function () { T.f.q = this.value; FL.lsSet('pack.trk.f', T.f); clearTimeout(T._qt); T._qt = setTimeout(T.paint, 200); };
        $('pt-days').onchange = function () { T.f.days = +this.value; FL.lsSet('pack.trk.f', T.f); T.refresh(); };
        body.querySelectorAll('#pt-view button').forEach(function (b) { b.onclick = function () { T.f.view = b.dataset.v; FL.lsSet('pack.trk.f', T.f); body.querySelectorAll('#pt-view button').forEach(function (x) { x.classList.toggle('on', x === b); }); T.paint(); }; });
        $('pt-ref').onclick = T.refresh;
        $('pt-new').onclick = function () { T.mode = 'new'; T.render(body); };
        $('pt-rc').onclick = function () { T.receipts().then(T.refresh); };
        T.refresh();
        T.paintLinks();
        clearInterval(T._iv); T._iv = setInterval(function () { if (FL.tab === 'packs' && FL.packDesign.at === 'dist' && !document.hidden) T.refresh(true); else if (FL.packDesign.at !== 'dist') clearInterval(T._iv); }, 60000);
    };
    T.paintLinks = function () {
        var el = $('pt-links'); if (!el) return;
        var paint = function () {
            el.innerHTML = T.linksOk ? '<span class="tag good" title="' + esc(T.base()) + 'pack/…"><i class="fa-solid fa-link"></i> tracking links work</span>'
                : '<span class="tag warn">tracking links not set up</span> <button class="btn sm" id="pt-setup" title="Creates the picture and confirmation endpoints in APEX (apex_sql/95)">Set up</button>';
            if ($('pt-setup')) $('pt-setup').onclick = function () { T.setup().then(paint); };
        };
        if (T.linksOk == null) { el.innerHTML = '<span class="muted">checking the links…</span>'; T.check().then(paint); } else paint();
    };
    T.refresh = function (quiet) {
        if (!quiet && $('pt-main')) $('pt-main').innerHTML = '<div class="card muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>';
        return T.load().then(T.paint).catch(function (e) { if ($('pt-main')) $('pt-main').innerHTML = '<div class="card"><p class="neg">✗ ' + esc(String(e && e.message || e)) + '</p></div>'; });
    };
    var pill = function (st, title) { var s = T.STATES[st]; return '<span class="pt-pill ' + s.cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><i class="fa-solid ' + s.icon + '"></i> ' + s.label + '</span>'; };
    /** The steps of one copy as a small timeline */
    T.steps = function (r) {
        var st = [['Sent', r.SENT_AT || (r.STATUS === 'PENDING' ? null : r.send.at), r.STATUS === 'FAILED' ? 'bad' : ''], ['Delivered', r.DELIVERED_AT, ''], ['Opened', r.FIRST_OPEN, ''], ['Read', r.READ_AT, ''], ['Confirmed', r.ACK_AT, 'good']];
        if (r.BOUNCED_AT) st = [['Sent', r.SENT_AT, ''], ['Bounced', r.BOUNCED_AT, 'bad']];
        return '<span class="pt-steps">' + st.map(function (x) { return '<i class="' + (x[1] ? 'done ' + x[2] : '') + '" title="' + esc(x[0] + (x[1] ? ' · ' + full(x[1]) : ' — not yet')) + '"></i>'; }).join('') + '</span>';
    };
    T.filtered = function () {
        var q = (T.f.q || '').toLowerCase().trim();
        return (T.rows || []).filter(function (r) {
            if (T.f.st && r.state !== T.f.st && !(T.f.st === 'WAIT' && ['SENT', 'DELIVERED', 'OPENED', 'READ'].indexOf(r.state) >= 0) && !(T.f.st === 'BAD' && (r.state === 'FAILED' || r.state === 'BOUNCED'))) return false;
            return !q || [r.EMAIL, r.send.PACK_NAME, r.send.TITLE, r.send.PERIOD, r.send.DOC_ID, r.send.SUBJECT].join(' ').toLowerCase().indexOf(q) >= 0;
        });
    };
    T.paint = function () {
        if (!$('pt-main') || !T.rows) return;
        var all = T.rows, cnt = function (f) { return all.filter(f).length; }, n = all.length, pct = function (x) { return n ? Math.round(x * 100 / n) + '%' : '–'; };
        var tracked = all.filter(function (r) { return r.send.TRACKED === 'Y'; }), tn = tracked.length;
        var k = [['Packs sent', (T.sends || []).length, '', ''], ['Copies', n, 'people × packs', ''],
            ['Delivered', pct(cnt(function (r) { return r.DELIVERED_AT || +r.OPENS > 0 || r.READ_AT || r.ACK_AT; })), 'delivery receipt, opened, read or confirmed', ''],
            ['Opened', tn ? Math.round(tracked.filter(function (r) { return +r.OPENS > 0 || r.ACK_AT; }).length * 100 / tn) + '%' : '–', 'of tracked copies — pictures shown or confirmed', ''],
            ['Confirmed', tn ? Math.round(tracked.filter(function (r) { return r.ACK_AT; }).length * 100 / tn) + '%' : '–', 'pressed "I have received it"', 'ACK'],
            ['Waiting', cnt(function (r) { return ['SENT', 'DELIVERED', 'OPENED', 'READ'].indexOf(r.state) >= 0; }), 'not confirmed yet', 'WAIT'],
            ['Problems', cnt(function (r) { return r.state === 'FAILED' || r.state === 'BOUNCED'; }), 'not sent or bounced', 'BAD']];
        $('pt-kpis').innerHTML = k.map(function (x) { return '<button class="pt-kpi' + (x[3] && T.f.st === x[3] ? ' on' : '') + '"' + (x[3] ? ' data-st="' + x[3] + '"' : ' disabled') + '><b>' + x[1] + '</b><span>' + x[0] + '</span><small>' + x[2] + '</small></button>'; }).join('');
        $('pt-kpis').querySelectorAll('[data-st]').forEach(function (b) { b.onclick = function () { var v = b.dataset.st; T.f.st = T.f.st === v ? '' : v; T.paint(); }; });
        $('pt-chips').innerHTML = T.f.st ? '<span class="chip">' + esc(T.f.st === 'WAIT' ? 'Waiting' : T.f.st === 'BAD' ? 'Problems' : (T.STATES[T.f.st] || {}).label || T.f.st) + ' <a id="pt-clr">×</a></span>' : '';
        if ($('pt-clr')) $('pt-clr').onclick = function () { T.f.st = ''; T.paint(); };
        var rows = T.filtered();
        if (!all.length) { $('pt-main').innerHTML = '<div class="card"><p class="muted">Nothing sent yet in this period. Packs e-mailed from a design (E-mail…) are recorded here — who received them, when, and whether they opened and confirmed them.</p></div>'; return; }
        if ((T.f.view || 'sends') === 'people') return T.paintPeople(rows);
        var bySend = {}; rows.forEach(function (r) { (bySend[r.SEND_ID] = bySend[r.SEND_ID] || []).push(r); });
        $('pt-main').innerHTML = (T.sends || []).filter(function (s) { return bySend[s.SEND_ID]; }).map(function (s) {
            var rc = bySend[s.SEND_ID], tally = {}; rc.forEach(function (r) { tally[r.state] = (tally[r.state] || 0) + 1; });
            var open = T.openSend === s.SEND_ID;
            return '<div class="card pt-send' + (open ? ' open' : '') + '" data-s="' + esc(s.SEND_ID) + '"><div class="pt-sh"><i class="fa-solid fa-chevron-right pt-car"></i><div class="pt-st"><b>' + esc(s.TITLE || s.PACK_NAME) + ' · ' + esc(s.PERIOD || '') + '</b>' +
                '<div class="sm muted">' + esc(full(s.at)) + ' · ' + esc({ GRAPH: 'Microsoft 365', OUTLOOK: 'Outlook', SMTP: 'SMTP' }[s.METHOD] || s.METHOD || '') + (s.MAILBOX ? ' · from ' + esc(s.MAILBOX) : '') + (s.APP_USER ? ' · by ' + esc(s.APP_USER) : '') + ' · <span class="mono">' + esc(s.DOC_ID || s.SEND_ID) + '</span>' + (s.TRACKED === 'Y' ? ' · tracked' : '') + '</div></div>' +
                '<button class="btn sm" data-open="' + esc(s.SEND_ID) + '" title="The whole record: people, the e-mail, the pack with its figures">Open <i class="fa-solid fa-arrow-right"></i></button><div class="pt-tally">' + Object.keys(T.STATES).filter(function (st) { return tally[st]; }).map(function (st) { return pill(st) + '<b>' + tally[st] + '</b>'; }).join('') + '</div></div>' +
                (open ? '<table class="tbl pt-tbl"><thead><tr><th>Recipient</th><th></th><th>Status</th><th>Progress</th><th>Sent</th><th>Delivered</th><th>Opened</th><th>Read</th><th>Confirmed</th></tr></thead><tbody>' + rc.map(function (r) {
                    return '<tr><td><b>' + esc(r.EMAIL) + '</b></td><td><span class="pt-k">' + esc(r.KIND || '') + '</span></td><td>' + pill(r.state, r.ERROR_TEXT || r.BOUNCE_TEXT || T.openHint(r)) + '</td><td>' + T.steps(r) + '</td>' +
                        '<td>' + esc(when(r.SENT_AT)) + '</td><td>' + esc(when(r.DELIVERED_AT)) + '</td><td>' + (+r.OPENS > 0 ? esc(when(r.FIRST_OPEN)) + (+r.OPENS > 1 ? ' <span class="muted">· ' + r.OPENS + '×</span>' : '') : '') + '</td><td>' + esc(when(r.READ_AT)) + '</td><td>' + esc(when(r.ACK_AT)) + '</td></tr>' +
                        (r.ERROR_TEXT || r.BOUNCE_TEXT ? '<tr class="pt-err"><td colspan="9">' + esc(r.ERROR_TEXT || r.BOUNCE_TEXT) + '</td></tr>' : '');
                }).join('') + '</tbody></table><div class="row sm" style="margin-top:6px;gap:8px">' + (s.SHA256 ? '<span class="muted">fingerprint <span class="mono">' + esc(String(s.SHA256).slice(0, 16)) + '…</span></span>' : '') + '<span class="grow"></span><button class="btn sm" data-csv="' + esc(s.SEND_ID) + '"><i class="fa-solid fa-download"></i> CSV</button></div>' : '') + '</div>';
        }).join('') || '<div class="card muted">Nothing matches.</div>';
        $('pt-main').querySelectorAll('.pt-send').forEach(function (c) {
            c.querySelector('[data-open]').onclick = function (e) { e.stopPropagation(); T.detailId = c.dataset.s; T.render(T.body); };
            c.querySelector('.pt-sh').onclick = function () { T.openSend = T.openSend === c.dataset.s ? null : c.dataset.s; T.paint(); };
            var b = c.querySelector('[data-csv]'); if (b) b.onclick = function () { T.csv(bySend[c.dataset.s]); };
        });
    };
    T.paintPeople = function (rows) {
        var by = {};
        rows.forEach(function (r) { var k = r.EMAIL.toLowerCase(), o = by[k] = by[k] || { email: r.EMAIL, n: 0, ack: 0, opened: 0, bad: 0, last: null, lastR: null, list: [] }; o.n++; if (r.ACK_AT) o.ack++; if (+r.OPENS > 0 || r.READ_AT || r.ACK_AT) o.opened++; if (r.state === 'FAILED' || r.state === 'BOUNCED') o.bad++; if (!o.last || r.send.at > o.last) { o.last = r.send.at; o.lastR = r; } o.list.push(r); });
        var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.last - a.last; });
        $('pt-main').innerHTML = '<div class="card"><table class="tbl pt-tbl"><thead><tr><th>Person</th><th>Packs received</th><th>Opened / read</th><th>Confirmed</th><th>Problems</th><th>Last pack</th><th>Its status</th></tr></thead><tbody>' + list.map(function (o) {
            var r = o.lastR;
            return '<tr class="pt-prow" data-e="' + esc(o.email) + '"><td><b>' + esc(o.email) + '</b></td><td>' + o.n + '</td><td>' + o.opened + '</td><td>' + o.ack + ' <span class="pt-bar"><i style="width:' + Math.round(o.ack * 100 / o.n) + '%"></i></span></td><td>' + (o.bad ? '<span class="neg">' + o.bad + '</span>' : '') + '</td>' +
                '<td>' + esc(r.send.TITLE || r.send.PACK_NAME) + ' · ' + esc(r.send.PERIOD || '') + '<div class="sm muted">' + esc(full(r.send.at)) + '</div></td><td>' + pill(r.state, T.openHint(r)) + '</td></tr>' +
                (T.openPerson === o.email ? '<tr><td colspan="7"><div class="pt-hist">' + o.list.sort(function (a, b) { return b.send.at - a.send.at; }).map(function (x) { return '<div>' + pill(x.state) + ' <b>' + esc(x.send.TITLE || x.send.PACK_NAME) + ' · ' + esc(x.send.PERIOD || '') + '</b> <span class="muted sm">' + esc(full(x.send.at)) + ' · ' + esc(x.KIND || '') + ' · ' + esc(x.send.DOC_ID || '') + '</span> ' + T.steps(x) + '</div>'; }).join('') + '</div></td></tr>' : '');
        }).join('') + '</tbody></table></div>';
        $('pt-main').querySelectorAll('.pt-prow').forEach(function (tr) { tr.onclick = function () { T.openPerson = T.openPerson === tr.dataset.e ? null : tr.dataset.e; T.paint(); }; });
    };
    // ── one distribution: everything that was sent ──
    T.renderDetail = function (body, id) {
        var back = function () { T.detailId = null; T.render(body); };
        body.innerHTML = '<div class="card muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Opening ' + esc(id) + '…</div>';
        (T.rows ? Promise.resolve() : T.load()).then(function () {
            var s = (T.sends || []).filter(function (x) { return x.SEND_ID === id; })[0];
            if (!s) return T.load().then(function () { return (T.sends || []).filter(function (x) { return x.SEND_ID === id; })[0]; });
            return s;
        }).then(function (s) {
            if (!s) { body.innerHTML = '<div class="card"><p class="neg">Distribution ' + esc(id) + ' was not found.</p><button class="btn" id="pd-back">← Back</button></div>'; $('pd-back').onclick = back; return; }
            var rc = s.rc || [], tally = {}; rc.forEach(function (r) { tally[r.state] = (tally[r.state] || 0) + 1; });
            var tab = T.dTab || 'people';
            body.innerHTML = '<div class="card pd-head"><div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn sm" id="pd-back"><i class="fa-solid fa-arrow-left"></i> Distribution</button>' +
                '<div><div class="sm muted">' + esc(s.COMPANY || '') + '</div><h3 style="margin:0">' + esc(s.TITLE || s.PACK_NAME) + ' · ' + esc(s.PERIOD || '') + '</h3>' +
                '<div class="sm muted">' + esc(full(s.at)) + ' · ' + esc({ GRAPH: 'Microsoft 365', OUTLOOK: 'Outlook', SMTP: 'SMTP' }[s.METHOD] || s.METHOD || '') + (s.MAILBOX ? ' · from ' + esc(s.MAILBOX) : '') + (s.APP_USER ? ' · by ' + esc(s.APP_USER) : '') + (s.LEDGERS ? ' · ' + esc(s.LEDGERS) : '') + '</div></div><span class="grow"></span>' +
                '<div class="pd-id"><span class="sm muted">Document</span><b class="mono">' + esc(s.DOC_ID || s.SEND_ID) + '</b>' + (s.SHA256 ? '<span class="sm muted mono" title="SHA-256 of the attached pack">' + esc(String(s.SHA256).slice(0, 20)) + '…</span>' : '') + '</div></div>' +
                '<div class="pt-tally" style="justify-content:flex-start;margin-top:8px">' + Object.keys(T.STATES).filter(function (st) { return tally[st]; }).map(function (st) { return pill(st) + '<b>' + tally[st] + '</b>'; }).join('') + '<span class="sm muted" style="margin-left:6px">' + rc.length + ' people · ' + esc(s.SUBJECT || '') + '</span></div></div>' +
                '<div class="pk-tabbar pd-tabs">' + [['people', 'fa-users', 'People'], ['email', 'fa-envelope', 'The e-mail'], ['pack', 'fa-book-open', 'The pack'], ['figures', 'fa-table-cells-large', 'Figures'], ['trail', 'fa-clock-rotate-left', 'Trail']].map(function (t) {
                    return '<button class="pk-tab' + (tab === t[0] ? ' on' : '') + '" data-dt="' + t[0] + '"><i class="fa-solid ' + t[1] + '"></i> ' + t[2] + '</button>'; }).join('') + '</div><div id="pd-body"></div>';
            $('pd-back').onclick = back;
            body.querySelectorAll('[data-dt]').forEach(function (b) { b.onclick = function () { T.dTab = b.dataset.dt; T.renderDetail(body, id); }; });
            var pb = $('pd-body');
            if (tab === 'people') {
                pb.innerHTML = '<div class="card"><table class="tbl pt-tbl"><thead><tr><th>Recipient</th><th></th><th>Status</th><th>Progress</th><th>Sent</th><th>Delivered</th><th>Opened</th><th>Read</th><th>Confirmed</th></tr></thead><tbody>' + rc.map(function (r) {
                    return '<tr><td><b>' + esc(r.EMAIL) + '</b></td><td><span class="pt-k">' + esc(r.KIND || '') + '</span></td><td>' + pill(r.state, r.ERROR_TEXT || r.BOUNCE_TEXT || T.openHint(r)) + '</td><td>' + T.steps(r) + '</td>' +
                        '<td>' + esc(full(r.SENT_AT)) + '</td><td>' + esc(full(r.DELIVERED_AT)) + '</td><td>' + (+r.OPENS > 0 ? esc(full(r.FIRST_OPEN)) + (+r.OPENS > 1 ? ' <span class="muted">· ' + r.OPENS + '×</span>' : '') : '') + '</td><td>' + esc(full(r.READ_AT)) + '</td><td>' + esc(full(r.ACK_AT)) + '</td></tr>' +
                        (r.ERROR_TEXT || r.BOUNCE_TEXT ? '<tr class="pt-err"><td colspan="9">' + esc(r.ERROR_TEXT || r.BOUNCE_TEXT) + '</td></tr>' : '');
                }).join('') + '</tbody></table><div class="row" style="margin-top:8px"><span class="grow"></span><button class="btn sm" id="pd-csv"><i class="fa-solid fa-download"></i> CSV</button></div></div>';
                $('pd-csv').onclick = function () { T.csv(rc); };
            } else if (tab === 'email') {
                pb.innerHTML = '<div class="card muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the e-mail…</div>';
                T.clob(id, 'email_html').then(function (h) {
                    if (!h) { pb.innerHTML = '<div class="card muted">The e-mail text was not kept for this send (sent before the text was recorded).</div>'; return; }
                    h = h.replace(/src="cid:[^"]+"/g, 'src="data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="580" height="60"><rect width="100%" height="100%" fill="#f1f5f9"/><text x="50%" y="55%" text-anchor="middle" font-family="Segoe UI,Arial" font-size="13" fill="#64748b">picture sent inside the e-mail</text></svg>') + '"');
                    pb.innerHTML = '<div class="card"><div class="sm muted" style="margin-bottom:6px">Subject: <b>' + esc(s.SUBJECT || '') + '</b> · one person\'s copy — every copy had the same text, with that person\'s own confirmation button</div><iframe class="pd-frame" id="pd-mail" title="The e-mail"></iframe></div>';
                    $('pd-mail').srcdoc = h;
                }).catch(function (e) { pb.innerHTML = '<div class="card neg">' + esc(String(e && e.message || e)) + '</div>'; });
            } else if (tab === 'pack' || tab === 'figures' || tab === 'trail') {
                pb.innerHTML = '<div class="card muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the archive…</div>';
                var R = FL.packArchive;
                R.ensure().then(function () { return FL.apexStore.read('SELECT archive_id, status, sha256, html_len, saved_by, saved_at, comments, meeting_date FROM wms_fin_pack_archive WHERE archive_id = ' + lit(id), 1); }).then(function (a) {
                    if (!a.length) { pb.innerHTML = '<div class="card muted">This send has no archived copy (the pack file and figures are kept for distributions made with New distribution, or saved with Save to archive).</div>'; return; }
                    a = a[0];
                    if (tab === 'trail') return R.events(id).then(function (ev) {
                        pb.innerHTML = '<div class="card"><table class="tbl pt-tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>' + ev.map(function (e) { return '<tr><td>' + esc(e.EVENT_AT || '') + '</td><td>' + esc(e.EVENT_BY || '') + '</td><td><b>' + esc(e.EVENT || '') + '</b></td><td style="white-space:normal">' + esc(e.DETAIL || '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
                    });
                    if (tab === 'figures') return R.clob(id, 'model_json').then(function (j) {
                        var m = {}; try { m = JSON.parse(j || '{}'); } catch (e) { /* cut */ }
                        var sc = /million/i.test(m.scaleLabel || '') ? 1e6 : /thousand/i.test(m.scaleLabel || '') ? 1e3 : 1, n = function (v) { return v == null || isNaN(v) ? '–' : FINE.fmt(+v / sc, 'num', { decimals: sc > 1 ? 0 : 2 }); };
                        pb.innerHTML = '<div class="card"><div class="sm muted">The figures as they were sent — ' + esc(m.filter || '') + ' · ' + esc(m.period || '') + ' · amounts in ' + esc(m.scaleLabel || '') + '</div>' +
                            '<div class="pd-tiles">' + (m.tiles || []).map(function (t) { return '<div class="pd-tile"><span>' + esc(t.label) + '</span><b>' + t.value + '</b><small class="' + (t.good == null ? '' : t.good ? 'pos' : 'neg') + '">' + esc(t.delta || '') + '</small></div>'; }).join('') + '</div>' +
                            ((m.keyLines || []).length ? '<h4>Income statement at a glance</h4><table class="tbl pt-tbl"><thead><tr><th></th><th>Month</th><th>YTD</th><th>YTD budget</th><th>YTD last year</th></tr></thead><tbody>' + m.keyLines.map(function (r) { return '<tr' + (r.bold ? ' style="font-weight:700"' : '') + '><td>' + esc(r.label) + '</td><td>' + n(r.m) + '</td><td>' + n(r.y) + '</td><td>' + n(r.yb) + '</td><td>' + n(r.py) + '</td></tr>'; }).join('') + '</tbody></table>' : '') +
                            ((m.highlights || []).length ? '<h4>Highlights</h4><ul>' + m.highlights.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>' : '') +
                            ((m.notes || []).length ? '<h4>Notes sent with it</h4><ul>' + m.notes.map(function (x) { return '<li><b>' + esc(x.title || x.kind || '') + '</b> ' + esc(x.body || '') + '</li>'; }).join('') + '</ul>' : '') + '</div>';
                    });
                    return R.clob(id, 'html').then(function (h) {
                        return R.sha256(h).then(function (sha) {
                            var ok = a.SHA256 && sha === a.SHA256;
                            pb.innerHTML = '<div class="card"><div class="row" style="gap:8px;flex-wrap:wrap"><span class="pt-pill ' + (ok ? 'good' : 'bad') + '"><i class="fa-solid ' + (ok ? 'fa-shield-halved' : 'fa-triangle-exclamation') + '"></i> ' + (ok ? 'Unchanged since it was sent — fingerprint matches' : 'Fingerprint does not match') + '</span>' +
                                '<span class="sm muted">' + Math.round(h.length / 1024) + ' KB · archived by ' + esc(a.SAVED_BY || '') + ' · ' + esc(a.SAVED_AT || '') + (a.COMMENTS ? ' · ' + esc(a.COMMENTS) : '') + '</span><span class="grow"></span>' +
                                '<button class="btn sm" id="pd-full"><i class="fa-solid fa-up-right-and-down-left-from-center"></i> Open</button><button class="btn sm" id="pd-dl"><i class="fa-solid fa-download"></i> Download</button></div><iframe class="pd-frame pd-pack" id="pd-pack" title="The pack as sent"></iframe></div>';
                            $('pd-pack').srcdoc = h;
                            $('pd-full').onclick = function () { FL.packView(h, { title: (s.TITLE || s.PACK_NAME) + ' · ' + (s.PERIOD || '') }); };
                            $('pd-dl').onclick = function () { FL.download((s.FILE_NAME || id + '.html'), new Blob([h], { type: 'text/html' })); };
                        });
                    });
                }).catch(function (e) { pb.innerHTML = '<div class="card neg">' + esc(String(e && e.message || e)) + '</div>'; });
            }
        }).catch(function (e) { body.innerHTML = '<div class="card neg">' + esc(String(e && e.message || e)) + '</div>'; });
    };
    T.csv = function (rc) {
        var head = ['Document', 'Pack', 'Period', 'Sent', 'Recipient', 'Kind', 'Status', 'Delivered', 'Opened', 'Opens', 'Read', 'Confirmed', 'Problem'];
        var lines = [head].concat(rc.map(function (r) { return [r.send.DOC_ID, r.send.TITLE || r.send.PACK_NAME, r.send.PERIOD, full(r.SENT_AT || r.send.at), r.EMAIL, r.KIND, T.STATES[r.state].label, full(r.DELIVERED_AT), full(r.FIRST_OPEN), r.OPENS || 0, full(r.READ_AT), full(r.ACK_AT), r.ERROR_TEXT || r.BOUNCE_TEXT || '']; }));
        FL.download('distribution-' + (rc[0] && rc[0].send.DOC_ID || 'pack') + '.csv', new Blob(['﻿' + lines.map(function (l) { return l.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n')], { type: 'text/csv' }));
    };
})();

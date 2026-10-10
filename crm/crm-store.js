/* Customer CRM · APEX + DuckDB layer (window.CRMS), built on the Debtors store (../debtors/dc-store.js = DCS: the host bridge,
 * the ai/executequery | executewrite gateway, CLOB helpers, Fusion SQL, the DuckDB file). Tables are created on first use;
 * the same DDL is in apex_sql/100_crm.sql, and Setup › Database objects shows / creates every object.
 *   WMS_CRM_SETTINGS       JSON per key (SETUP = categories, queues, agents, SLA, business hours, rules, canned replies, phone)
 *   WMS_CRM_TICKETS        one row per ticket (number CS-000123 from WMS_CRM_TICKET_SEQ, SLA due dates, token for the customer page)
 *   WMS_CRM_TICKET_EVENTS  the ticket's conversation and history (public replies, internal notes, status, assignment, customer)
 *   WMS_CRM_CALLS          every call in / out: number, customer, agent, times, outcome, notes, recording file + SHA-256, callback
 *   WMS_CRM_MESSAGES       every e-mail sent from the CRM (to, subject, attachments with their fingerprints, ticket, statement)
 *   WMS_CRM_CONTACTS       people at the customer kept by the CRM (beside the Fusion contacts)
 * Times are written with SYSDATE (the database clock) and shown in this PC's wall time (DCS.local); due dates are worked
 * out on this PC in its wall time and written back in database time (CRMS.dbTime). Reads never contain the gateway's
 * refused words (UPDATE / DELETE / DBMS_ / UTL_). Customer-facing pages: crm/new/:key (raise a ticket) and crm/t/:tok
 * (see a ticket, reply, rate it) — procedures WMS_CRM_PORTAL / WMS_CRM_TK, ORDS in the WAREHOUSEMANAGEMENT module. */
(function (root) {
    'use strict';
    var D = root.DCS, C = root.CRMS = {};
    var lit = D.lit, num = D.num, TS = "'YYYY-MM-DD HH24:MI'";
    C.D = D;

    // ── times ─────────────────────────────────────────────────────
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function stamp(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    /** now in this PC's wall time 'YYYY-MM-DD HH:MI' */
    C.now = function () { return stamp(new Date()); };
    /** a wall-time stamp of this PC (or Date) → the same moment as a database DATE literal */
    C.dbTime = function (v) {
        if (!v) return 'NULL';
        var d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T'));
        if (isNaN(d)) return 'NULL';
        var t = new Date(d.getTime() - (D.offset || 0));
        return "TO_DATE('" + stamp(t) + "', 'YYYY-MM-DD HH24:MI')";
    };
    var DATES = ['CREATED_AT', 'CHANGED_AT', 'DUE_FIRST', 'DUE_RESOLVE', 'FIRST_RESPONSE_AT', 'RESOLVED_AT', 'CLOSED_AT', 'PAUSED_AT', 'EVENT_AT', 'STARTED_AT', 'ANSWERED_AT', 'ENDED_AT', 'CALLBACK_AT', 'SENT_AT', 'CSAT_AT', 'LAST_CUSTOMER_AT'];
    function loc(rows) { (rows || []).forEach(function (r) { DATES.forEach(function (k) { if (r[k]) r[k] = D.local(r[k]); }); }); return rows; }
    function cols(list) { return list.map(function (c) { return DATES.indexOf(c) >= 0 ? 'TO_CHAR(' + c.toLowerCase() + ', ' + TS + ') AS ' + c : c.toLowerCase() + ' AS ' + c; }).join(', '); }
    function like(q) { return lit('%' + String(q).toUpperCase().replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%', 200); }
    function setList(sets) {
        return Object.keys(sets).map(function (k) {
            var v = sets[k];
            return k + ' = ' + (v === 'SYSDATE' ? 'SYSDATE' : v && typeof v === 'object' && v.sql ? v.sql : v && typeof v === 'object' && v.at ? C.dbTime(v.at) : typeof v === 'number' ? num(v) : lit(v, 4000));
        }).join(', ');
    }
    C.setList = setList;

    // ── tables ────────────────────────────────────────────────────
    C.DDL = {
        WMS_CRM_SETTINGS: 'CREATE TABLE wms_crm_settings (skey VARCHAR2(60) PRIMARY KEY, sval CLOB, changed_by VARCHAR2(100), changed_date DATE DEFAULT SYSDATE)',
        WMS_CRM_TICKETS: 'CREATE TABLE wms_crm_tickets (ticket_id VARCHAR2(40) PRIMARY KEY, ticket_no VARCHAR2(30), pod VARCHAR2(20), bu_id VARCHAR2(30), account_number VARCHAR2(60), account_name VARCHAR2(360), ' +
            'contact_name VARCHAR2(200), contact_email VARCHAR2(320), contact_phone VARCHAR2(60), subject VARCHAR2(400), description VARCHAR2(4000), category VARCHAR2(100), subcategory VARCHAR2(100), ' +
            "priority VARCHAR2(4) DEFAULT 'P3', status VARCHAR2(20) DEFAULT 'NEW', channel VARCHAR2(20), queue VARCHAR2(100), assigned_to VARCHAR2(100), order_number VARCHAR2(60), invoice_number VARCHAR2(60), item_number VARCHAR2(100), " +
            'tags VARCHAR2(400), due_first DATE, due_resolve DATE, first_response_at DATE, resolved_at DATE, closed_at DATE, paused_at DATE, resolution VARCHAR2(4000), reopened_n NUMBER DEFAULT 0, ' +
            'csat NUMBER, csat_comment VARCHAR2(1000), csat_at DATE, ai_category VARCHAR2(100), ai_conf NUMBER, token VARCHAR2(64), last_customer_at DATE, parent_id VARCHAR2(40), ' +
            'created_by VARCHAR2(100), created_at DATE DEFAULT SYSDATE, changed_by VARCHAR2(100), changed_date DATE DEFAULT SYSDATE)',
        WMS_CRM_TICKET_EVENTS: "CREATE TABLE wms_crm_ticket_events (event_id VARCHAR2(40) PRIMARY KEY, ticket_id VARCHAR2(40) NOT NULL, kind VARCHAR2(20), body VARCHAR2(4000), visibility VARCHAR2(10) DEFAULT 'INTERNAL', meta VARCHAR2(2000), by_user VARCHAR2(100), event_at DATE DEFAULT SYSDATE)",
        WMS_CRM_CALLS: "CREATE TABLE wms_crm_calls (call_id VARCHAR2(40) PRIMARY KEY, direction VARCHAR2(3), number_raw VARCHAR2(60), number_e164 VARCHAR2(30), bu_id VARCHAR2(30), account_number VARCHAR2(60), account_name VARCHAR2(360), contact_name VARCHAR2(200), " +
            'agent VARCHAR2(100), machine VARCHAR2(100), started_at DATE, answered_at DATE, ended_at DATE, duration_s NUMBER, outcome VARCHAR2(20), disposition VARCHAR2(100), notes VARCHAR2(4000), ticket_id VARCHAR2(40), ' +
            "recording_path VARCHAR2(600), recording_sha VARCHAR2(64), recording_bytes NUMBER, source VARCHAR2(20) DEFAULT 'MANUAL', external_id VARCHAR2(100), callback_at DATE, callback_done VARCHAR2(1) DEFAULT 'N', created_at DATE DEFAULT SYSDATE)",
        WMS_CRM_MESSAGES: "CREATE TABLE wms_crm_messages (msg_id VARCHAR2(40) PRIMARY KEY, direction VARCHAR2(3) DEFAULT 'OUT', channel VARCHAR2(20) DEFAULT 'EMAIL', bu_id VARCHAR2(30), account_number VARCHAR2(60), account_name VARCHAR2(360), " +
            'to_addr VARCHAR2(1000), cc_addr VARCHAR2(1000), subject VARCHAR2(400), body VARCHAR2(4000), attachments VARCHAR2(2000), ticket_id VARCHAR2(40), stmt_id VARCHAR2(40), status VARCHAR2(20), error_text VARCHAR2(2000), ' +
            'method VARCHAR2(20), mailbox VARCHAR2(320), by_user VARCHAR2(100), machine VARCHAR2(100), created_at DATE DEFAULT SYSDATE, sent_at DATE)',
        WMS_CRM_CONTACTS: "CREATE TABLE wms_crm_contacts (contact_id VARCHAR2(40) PRIMARY KEY, bu_id VARCHAR2(30), account_number VARCHAR2(60), name VARCHAR2(200), role VARCHAR2(100), email VARCHAR2(320), phone VARCHAR2(60), mobile VARCHAR2(60), " +
            "is_primary VARCHAR2(1) DEFAULT 'N', notes VARCHAR2(1000), removed VARCHAR2(1) DEFAULT 'N', created_by VARCHAR2(100), created_at DATE DEFAULT SYSDATE, changed_by VARCHAR2(100), changed_date DATE DEFAULT SYSDATE)"
    };
    C.SEQ = 'CREATE SEQUENCE wms_crm_ticket_seq START WITH 1 INCREMENT BY 1 NOCACHE';
    C.INDEXES = [
        'CREATE INDEX wms_crm_tk_acct ON wms_crm_tickets (account_number)', 'CREATE INDEX wms_crm_tk_status ON wms_crm_tickets (status)', 'CREATE INDEX wms_crm_tk_tok ON wms_crm_tickets (token)',
        'CREATE INDEX wms_crm_ev_tk ON wms_crm_ticket_events (ticket_id)', 'CREATE INDEX wms_crm_call_acct ON wms_crm_calls (account_number)', 'CREATE INDEX wms_crm_call_e164 ON wms_crm_calls (number_e164)',
        'CREATE INDEX wms_crm_msg_acct ON wms_crm_messages (account_number)', 'CREATE INDEX wms_crm_ct_acct ON wms_crm_contacts (account_number)'
    ];
    var ensured = null;
    C.ensure = function () {
        if (ensured) return ensured;
        var names = Object.keys(C.DDL);
        ensured = D.rows("SELECT table_name AS T FROM user_tables WHERE table_name IN ('" + names.join("','") + "')", 20).then(function (r) {
            var have = {}; r.forEach(function (x) { have[String(x.T).toUpperCase()] = 1; });
            var missing = names.filter(function (t) { return !have[t]; });
            return missing.reduce(function (p, t) { return p.then(function () { return D.write(C.DDL[t]).catch(function (e) { if (!/ORA-00955/.test(e.message)) throw e; }); }); }, Promise.resolve())
                .then(function () { return D.rows("SELECT sequence_name AS T FROM user_sequences WHERE sequence_name = 'WMS_CRM_TICKET_SEQ'", 2); })
                .then(function (s) { if (!s.length) return D.write(C.SEQ).catch(function (e) { if (!/ORA-00955/.test(e.message)) throw e; }); })
                .then(function () { if (!missing.length) return; return C.INDEXES.reduce(function (p, d) { return p.then(function () { return D.write(d).catch(function () { }); }); }, Promise.resolve()); })
                .then(function () { return { created: missing }; });
        }).catch(function (e) { ensured = null; throw e; });
        return ensured;
    };

    // ── settings ──────────────────────────────────────────────────
    C.settings = {
        get: function (key) {
            return C.ensure().then(function () { return D.readClob('wms_crm_settings', 'sval', 'skey', [key]); })
                .then(function (m) { if (m[key] == null || m[key] === '') return null; try { return JSON.parse(m[key]); } catch (e) { return null; } });
        },
        save: function (key, value) {
            var me = lit(D.user());
            return C.ensure().then(function () {
                return D.write('MERGE INTO wms_crm_settings t USING (SELECT ' + lit(key) + ' AS skey FROM dual) s ON (t.skey = s.skey) WHEN MATCHED THEN UPDATE SET changed_by = ' + me + ', changed_date = SYSDATE WHEN NOT MATCHED THEN INSERT (skey, sval, changed_by, changed_date) VALUES (' + lit(key) + ', EMPTY_CLOB(), ' + me + ', SYSDATE)');
            }).then(function () { return D.writeClob('wms_crm_settings', 'sval', 'skey = ' + lit(key), JSON.stringify(value)); });
        }
    };

    // ── tickets ───────────────────────────────────────────────────
    C.TK = ['TICKET_ID', 'TICKET_NO', 'POD', 'BU_ID', 'ACCOUNT_NUMBER', 'ACCOUNT_NAME', 'CONTACT_NAME', 'CONTACT_EMAIL', 'CONTACT_PHONE', 'SUBJECT', 'DESCRIPTION', 'CATEGORY', 'SUBCATEGORY', 'PRIORITY', 'STATUS', 'CHANNEL',
        'QUEUE', 'ASSIGNED_TO', 'ORDER_NUMBER', 'INVOICE_NUMBER', 'ITEM_NUMBER', 'TAGS', 'DUE_FIRST', 'DUE_RESOLVE', 'FIRST_RESPONSE_AT', 'RESOLVED_AT', 'CLOSED_AT', 'PAUSED_AT', 'RESOLUTION', 'REOPENED_N',
        'CSAT', 'CSAT_COMMENT', 'CSAT_AT', 'AI_CATEGORY', 'AI_CONF', 'TOKEN', 'LAST_CUSTOMER_AT', 'PARENT_ID', 'CREATED_BY', 'CREATED_AT', 'CHANGED_BY'];
    var TK_COLS = cols(C.TK) + ', TO_CHAR(changed_date, ' + TS + ') AS CHANGED_AT';
    C.tickets = {
        /** f = {open, status, account, buId, assigned, queue, q, since (YYYY-MM-DD), ids, limit} */
        list: function (f) {
            f = f || {}; var w = ['1 = 1'];
            if (f.open) w.push("status NOT IN ('RESOLVED', 'CLOSED')");
            if (f.status) w.push('status = ' + lit(f.status));
            if (f.account) w.push('account_number = ' + lit(f.account));
            if (f.buId) w.push('(bu_id = ' + lit(f.buId) + ' OR bu_id IS NULL)');
            if (f.assigned) w.push('UPPER(assigned_to) = ' + lit(String(f.assigned).toUpperCase()));
            if (f.queue) w.push('queue = ' + lit(f.queue));
            if (f.since) w.push('(created_at >= ' + D.date(f.since) + " OR status NOT IN ('RESOLVED', 'CLOSED') OR resolved_at >= " + D.date(f.since) + ')');
            if (f.ids && f.ids.length) w.push('ticket_id IN (' + f.ids.map(function (i) { return lit(i); }).join(', ') + ')');
            if (f.no) w.push('(ticket_no = ' + lit(f.no) + ' OR ticket_no LIKE ' + lit('%' + String(f.no).replace(/\D/g, '')) + ')');
            if (f.q) { var l = like(f.q); w.push('(UPPER(ticket_no) LIKE ' + l + " ESCAPE '\\' OR UPPER(subject) LIKE " + l + " ESCAPE '\\' OR UPPER(account_name) LIKE " + l + " ESCAPE '\\' OR UPPER(account_number) LIKE " + l + " ESCAPE '\\' OR UPPER(contact_name) LIKE " + l + " ESCAPE '\\' OR UPPER(order_number) LIKE " + l + " ESCAPE '\\')"); }
            return C.ensure().then(function () { return D.rowsAll('SELECT ' + TK_COLS + ' FROM wms_crm_tickets WHERE ' + w.join(' AND ') + ' ORDER BY created_at DESC, ticket_id', f.limit || 5000); }).then(loc);
        },
        get: function (id) { return C.tickets.list({ ids: [id], limit: 1 }).then(function (r) { return r[0] || null; }); },
        /** a new ticket → {id, no} (the number comes from the sequence) */
        create: function (t) {
            var id = t.TICKET_ID || ('tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
            var prefix = String(t.prefix || 'CS-').replace(/[^A-Za-z0-9-]/g, '').slice(0, 8);
            var c = ['ticket_id', 'ticket_no', 'pod', 'bu_id', 'account_number', 'account_name', 'contact_name', 'contact_email', 'contact_phone', 'subject', 'description', 'category', 'subcategory', 'priority', 'status', 'channel', 'queue',
                'assigned_to', 'order_number', 'invoice_number', 'item_number', 'tags', 'due_first', 'due_resolve', 'ai_category', 'ai_conf', 'token', 'parent_id', 'created_by', 'created_at', 'changed_by', 'changed_date'];
            var v = [lit(id), "'" + prefix + "' || LPAD(wms_crm_ticket_seq.NEXTVAL, 6, '0')", lit(t.POD), lit(t.BU_ID), lit(t.ACCOUNT_NUMBER, 60), lit(t.ACCOUNT_NAME, 360), lit(t.CONTACT_NAME, 200), lit(t.CONTACT_EMAIL, 320), lit(t.CONTACT_PHONE, 60),
                lit(t.SUBJECT, 400), lit(t.DESCRIPTION, 4000), lit(t.CATEGORY, 100), lit(t.SUBCATEGORY, 100), lit(t.PRIORITY || 'P3'), lit(t.STATUS || 'NEW'), lit(t.CHANNEL || 'PHONE'), lit(t.QUEUE, 100), lit(t.ASSIGNED_TO, 100),
                lit(t.ORDER_NUMBER, 60), lit(t.INVOICE_NUMBER, 60), lit(t.ITEM_NUMBER, 100), lit(t.TAGS, 400), C.dbTime(t.DUE_FIRST), C.dbTime(t.DUE_RESOLVE), lit(t.AI_CATEGORY, 100), num(t.AI_CONF), lit(t.TOKEN), lit(t.PARENT_ID), lit(D.user(), 100), 'SYSDATE', lit(D.user(), 100), 'SYSDATE'];
            return C.ensure().then(function () { return D.write('INSERT INTO wms_crm_tickets (' + c.join(', ') + ') VALUES (' + v.join(', ') + ')'); })
                .then(function () { return D.rows('SELECT ticket_no AS N FROM wms_crm_tickets WHERE ticket_id = ' + lit(id), 2); })
                .then(function (r) { return { id: id, no: r.length ? r[0].N : '' }; });
        },
        set: function (id, sets) { sets.changed_by = D.user(); sets.changed_date = 'SYSDATE'; return D.write('UPDATE wms_crm_tickets SET ' + setList(sets) + ' WHERE ticket_id = ' + lit(id)); },
        /** open tickets per agent (routing: the least busy) */
        load: function () {
            return C.ensure().then(function () { return D.rows("SELECT UPPER(assigned_to) AS U, COUNT(*) AS N FROM wms_crm_tickets WHERE status NOT IN ('RESOLVED', 'CLOSED') AND assigned_to IS NOT NULL GROUP BY UPPER(assigned_to)", 500); })
                .then(function (r) { var o = {}; r.forEach(function (x) { o[String(x.U).toLowerCase()] = +x.N; }); return o; });
        },
        /** resolved tickets with a resolution, for "similar tickets" and the classifiers */
        learning: function (limit) {
            return C.ensure().then(function () { return D.rowsAll("SELECT ticket_id AS TICKET_ID, ticket_no AS TICKET_NO, subject AS SUBJECT, description AS DESCRIPTION, category AS CATEGORY, subcategory AS SUBCATEGORY, priority AS PRIORITY, resolution AS RESOLUTION, status AS STATUS, account_name AS ACCOUNT_NAME FROM wms_crm_tickets WHERE category IS NOT NULL ORDER BY created_at DESC, ticket_id", limit || 3000); });
        }
    };
    C.events = {
        list: function (ticketIds) {
            if (!ticketIds || !ticketIds.length) return Promise.resolve([]);
            var chunks = []; for (var i = 0; i < ticketIds.length; i += 300) chunks.push(ticketIds.slice(i, i + 300));
            return Promise.all(chunks.map(function (ch) {
                return D.rowsAll('SELECT e.event_id AS EVENT_ID, e.ticket_id AS TICKET_ID, t.ticket_no AS TICKET_NO, e.kind AS KIND, e.body AS BODY, e.visibility AS VISIBILITY, e.meta AS META, e.by_user AS BY_USER, TO_CHAR(e.event_at, ' + TS + ') AS EVENT_AT' +
                    ' FROM wms_crm_ticket_events e LEFT JOIN wms_crm_tickets t ON t.ticket_id = e.ticket_id WHERE e.ticket_id IN (' + ch.map(function (x) { return lit(x); }).join(', ') + ') ORDER BY e.event_at, e.event_id', 20000);
            })).then(function (r) { return loc([].concat.apply([], r)); });
        },
        add: function (e) {
            return D.write('INSERT INTO wms_crm_ticket_events (event_id, ticket_id, kind, body, visibility, meta, by_user, event_at) VALUES (' +
                [lit(e.id || ('ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9))), lit(e.ticketId), lit(e.kind, 20), lit(e.body, 4000), lit(e.visibility || 'INTERNAL'), lit(e.meta ? JSON.stringify(e.meta) : null, 2000), lit(e.by || D.user(), 100), 'SYSDATE'].join(', ') + ')');
        },
        /** the latest events of every ticket (Today › activity) */
        recent: function (since) {
            return C.ensure().then(function () {
                return D.rows('SELECT e.event_id AS EVENT_ID, e.ticket_id AS TICKET_ID, t.ticket_no AS TICKET_NO, t.subject AS SUBJECT, t.account_name AS ACCOUNT_NAME, e.kind AS KIND, e.body AS BODY, e.by_user AS BY_USER, TO_CHAR(e.event_at, ' + TS + ') AS EVENT_AT' +
                    ' FROM wms_crm_ticket_events e JOIN wms_crm_tickets t ON t.ticket_id = e.ticket_id WHERE e.event_at >= ' + D.date(since) + ' ORDER BY e.event_at DESC FETCH FIRST 200 ROWS ONLY', 200);
            }).then(loc);
        }
    };

    // ── calls ─────────────────────────────────────────────────────
    C.CL = ['CALL_ID', 'DIRECTION', 'NUMBER_RAW', 'NUMBER_E164', 'BU_ID', 'ACCOUNT_NUMBER', 'ACCOUNT_NAME', 'CONTACT_NAME', 'AGENT', 'MACHINE', 'STARTED_AT', 'ANSWERED_AT', 'ENDED_AT', 'DURATION_S', 'OUTCOME', 'DISPOSITION',
        'NOTES', 'TICKET_ID', 'RECORDING_PATH', 'RECORDING_SHA', 'RECORDING_BYTES', 'SOURCE', 'EXTERNAL_ID', 'CALLBACK_AT', 'CALLBACK_DONE'];
    C.calls = {
        /** f = {since, account, agent, direction, outcome, callbacks (open callbacks), q, limit} */
        list: function (f) {
            f = f || {}; var w = ['1 = 1'];
            if (f.since) w.push('started_at >= ' + D.date(f.since));
            if (f.account) w.push('account_number = ' + lit(f.account));
            if (f.agent) w.push('UPPER(agent) = ' + lit(String(f.agent).toUpperCase()));
            if (f.direction) w.push('direction = ' + lit(f.direction));
            if (f.outcome) w.push('outcome = ' + lit(f.outcome));
            if (f.callbacks) w.push("callback_at IS NOT NULL AND NVL(callback_done, 'N') = 'N'");
            if (f.e164) w.push('number_e164 = ' + lit(f.e164));
            if (f.q) { var l = like(f.q); w.push('(UPPER(account_name) LIKE ' + l + " ESCAPE '\\' OR number_raw LIKE " + l + " ESCAPE '\\' OR UPPER(contact_name) LIKE " + l + " ESCAPE '\\' OR UPPER(notes) LIKE " + l + " ESCAPE '\\')"); }
            return C.ensure().then(function () { return D.rowsAll('SELECT ' + cols(C.CL) + ' FROM wms_crm_calls WHERE ' + w.join(' AND ') + ' ORDER BY started_at DESC, call_id', f.limit || 5000); }).then(loc);
        },
        add: function (c) {
            var k = ['call_id', 'direction', 'number_raw', 'number_e164', 'bu_id', 'account_number', 'account_name', 'contact_name', 'agent', 'machine', 'started_at', 'answered_at', 'ended_at', 'duration_s', 'outcome', 'disposition', 'notes', 'ticket_id', 'source', 'external_id', 'callback_at', 'created_at'];
            var v = [lit(c.id), lit(c.direction, 3), lit(c.number, 60), lit(c.e164, 30), lit(c.buId), lit(c.account, 60), lit(c.name, 360), lit(c.contact, 200), lit(c.agent || D.user(), 100), lit(c.machine, 100), C.dbTime(c.startedAt), C.dbTime(c.answeredAt), C.dbTime(c.endedAt),
                num(c.duration), lit(c.outcome, 20), lit(c.disposition, 100), lit(c.notes, 4000), lit(c.ticketId), lit(c.source || 'MANUAL', 20), lit(c.externalId, 100), C.dbTime(c.callbackAt), 'SYSDATE'];
            return C.ensure().then(function () { return D.write('INSERT INTO wms_crm_calls (' + k.join(', ') + ') VALUES (' + v.join(', ') + ')'); });
        },
        set: function (id, sets) { return D.write('UPDATE wms_crm_calls SET ' + setList(sets) + ' WHERE call_id = ' + lit(id)); }
    };

    // ── messages ──────────────────────────────────────────────────
    C.MS = ['MSG_ID', 'DIRECTION', 'CHANNEL', 'BU_ID', 'ACCOUNT_NUMBER', 'ACCOUNT_NAME', 'TO_ADDR', 'CC_ADDR', 'SUBJECT', 'BODY', 'ATTACHMENTS', 'TICKET_ID', 'STMT_ID', 'STATUS', 'ERROR_TEXT', 'METHOD', 'MAILBOX', 'BY_USER', 'MACHINE', 'CREATED_AT', 'SENT_AT'];
    C.messages = {
        list: function (f) {
            f = f || {}; var w = ['1 = 1'];
            if (f.since) w.push('created_at >= ' + D.date(f.since));
            if (f.account) w.push('account_number = ' + lit(f.account));
            if (f.ticketId) w.push('ticket_id = ' + lit(f.ticketId));
            if (f.status) w.push('status = ' + lit(f.status));
            if (f.q) { var l = like(f.q); w.push('(UPPER(subject) LIKE ' + l + " ESCAPE '\\' OR UPPER(to_addr) LIKE " + l + " ESCAPE '\\' OR UPPER(account_name) LIKE " + l + " ESCAPE '\\')"); }
            return C.ensure().then(function () { return D.rowsAll('SELECT ' + cols(C.MS) + ' FROM wms_crm_messages WHERE ' + w.join(' AND ') + ' ORDER BY created_at DESC, msg_id', f.limit || 5000); }).then(loc);
        },
        add: function (m) {
            var k = ['msg_id', 'direction', 'channel', 'bu_id', 'account_number', 'account_name', 'to_addr', 'cc_addr', 'subject', 'body', 'attachments', 'ticket_id', 'stmt_id', 'status', 'error_text', 'method', 'mailbox', 'by_user', 'machine', 'created_at'];
            var v = [lit(m.id), lit(m.direction || 'OUT'), lit(m.channel || 'EMAIL'), lit(m.buId), lit(m.account, 60), lit(m.name, 360), lit(m.to, 1000), lit(m.cc, 1000), lit(m.subject, 400), lit(m.body, 4000), lit(m.attachments, 2000),
                lit(m.ticketId), lit(m.stmtId), lit(m.status || 'PENDING'), lit(m.error, 2000), lit(m.method, 20), lit(m.mailbox, 320), lit(D.user(), 100), lit(m.machine, 100), 'SYSDATE'];
            return C.ensure().then(function () { return D.write('INSERT INTO wms_crm_messages (' + k.join(', ') + ') VALUES (' + v.join(', ') + ')'); });
        },
        sent: function (id, r) { return D.write('UPDATE wms_crm_messages SET status = ' + lit(r.status) + ', method = ' + lit(r.method, 20) + ', mailbox = ' + lit(r.mailbox, 320) + ', error_text = ' + lit(r.error, 2000) + (r.status === 'SENT' ? ', sent_at = SYSDATE' : '') + ' WHERE msg_id = ' + lit(id)); }
    };

    // ── contacts ──────────────────────────────────────────────────
    var CT = ['CONTACT_ID', 'BU_ID', 'ACCOUNT_NUMBER', 'NAME', 'ROLE', 'EMAIL', 'PHONE', 'MOBILE', 'IS_PRIMARY', 'NOTES', 'CREATED_BY', 'CREATED_AT'];
    C.contacts = {
        list: function (account) {
            return C.ensure().then(function () { return D.rowsAll('SELECT ' + cols(CT) + " FROM wms_crm_contacts WHERE NVL(removed, 'N') = 'N'" + (account ? ' AND account_number = ' + lit(account) : '') + ' ORDER BY account_number, is_primary DESC, name', 50000); }).then(loc);
        },
        save: function (c) {
            var me = lit(D.user());
            if (!c.CONTACT_ID) {
                c.CONTACT_ID = 'ct' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
                return C.ensure().then(function () {
                    return D.write('INSERT INTO wms_crm_contacts (contact_id, bu_id, account_number, name, role, email, phone, mobile, is_primary, notes, created_by, created_at, changed_by, changed_date) VALUES (' +
                        [lit(c.CONTACT_ID), lit(c.BU_ID), lit(c.ACCOUNT_NUMBER, 60), lit(c.NAME, 200), lit(c.ROLE, 100), lit(c.EMAIL, 320), lit(c.PHONE, 60), lit(c.MOBILE, 60), lit(c.IS_PRIMARY === 'Y' ? 'Y' : 'N'), lit(c.NOTES, 1000), me, 'SYSDATE', me, 'SYSDATE'].join(', ') + ')');
                });
            }
            return D.write('UPDATE wms_crm_contacts SET ' + setList({ name: c.NAME || '', role: c.ROLE || '', email: c.EMAIL || '', phone: c.PHONE || '', mobile: c.MOBILE || '', is_primary: c.IS_PRIMARY === 'Y' ? 'Y' : 'N', notes: c.NOTES || '', changed_by: D.user(), changed_date: 'SYSDATE' }) + ' WHERE contact_id = ' + lit(c.CONTACT_ID));
        },
        remove: function (id) { return D.write("UPDATE wms_crm_contacts SET removed = 'Y', changed_by = " + lit(D.user()) + ', changed_date = SYSDATE WHERE contact_id = ' + lit(id)); }
    };

    // ── the customer-facing pages (PL/SQL + ORDS) ─────────────────
    var STYLE = "body{margin:0;font:15px/1.5 \"Segoe UI\",Arial,sans-serif;background:#eef0fb;color:#0f172a}.c{max-width:640px;margin:6vh auto;background:#fff;border-radius:14px;padding:28px 32px;box-shadow:0 10px 30px rgba(15,23,42,.1)}" +
        "h1{font-size:21px;margin:0 0 6px}.m{color:#64748b;font-size:13px}label{display:block;font-size:13px;font-weight:600;color:#334155;margin:12px 0 4px}input,textarea,select{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:9px;padding:9px 11px;font:inherit}" +
        "textarea{min-height:120px}button{margin-top:16px;background:#4338ca;color:#fff;border:0;border-radius:9px;padding:11px 18px;font-weight:700;font-size:15px;cursor:pointer}.ok{color:#15803d;font-weight:700}" +
        ".ev{border-left:3px solid #c7d2fe;padding:6px 12px;margin:10px 0}.ev.cu{border-color:#94a3b8}.ev .w{font-size:12px;color:#64748b}.st{display:inline-block;background:#e0e7ff;color:#3730a3;border-radius:99px;padding:2px 10px;font-size:12px;font-weight:700}" +
        ".stars{display:flex;gap:6px;flex-wrap:wrap}.stars label{margin:0;font-weight:500}.f{margin-top:22px;font-size:12px;color:#94a3b8}";
    var HEAD = "PROCEDURE page (p_title IN VARCHAR2, p_body IN VARCHAR2) IS BEGIN OWA_UTIL.mime_header('text/html', FALSE, 'UTF-8'); HTP.p('Cache-Control: no-store'); OWA_UTIL.http_header_close; " +
        "HTP.p('<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>' || HTF.escape_sc(p_title) || '</title><style>" + STYLE.replace(/'/g, "''") + "</style></head><body><div class=\"c\">'); " +
        "HTP.p(p_body); HTP.p('<div class=\"f\">Customer care</div></div></body></html>'); END; ";
    /** crm/new/:key — GET = the form, POST = a new ticket (status NEW, channel PORTAL); the key is the portal key of Setup */
    C.PORTAL_SQL = "CREATE OR REPLACE PROCEDURE wms_crm_portal (p_key IN VARCHAR2, p_post IN VARCHAR2, p_name IN VARCHAR2, p_email IN VARCHAR2, p_phone IN VARCHAR2, p_account IN VARCHAR2, p_company IN VARCHAR2, p_subject IN VARCHAR2, p_text IN VARCHAR2, p_category IN VARCHAR2) AS " +
        "v_ok NUMBER; v_id VARCHAR2(40); v_no VARCHAR2(30); v_tok VARCHAR2(64); v_prefix VARCHAR2(10) := 'CS-'; v_cats VARCHAR2(4000); v_opts VARCHAR2(4000); v_cat VARCHAR2(100); v_n NUMBER; " + HEAD +
        "BEGIN SELECT COUNT(*) INTO v_ok FROM wms_crm_settings WHERE skey = 'PORTAL_KEY' AND TO_CHAR(SUBSTR(sval, 1, 200)) = '\"' || p_key || '\"' AND LENGTH(p_key) >= 12; " +
        "IF v_ok = 0 THEN page('Not available', '<h1>This page is not available</h1><p class=\"m\">The link may be out of date. Please contact us by phone or e-mail.</p>'); RETURN; END IF; " +
        "BEGIN SELECT REPLACE(TO_CHAR(SUBSTR(sval, 1, 3900)), '\"', '') INTO v_cats FROM wms_crm_settings WHERE skey = 'PORTAL_CATEGORIES'; EXCEPTION WHEN NO_DATA_FOUND THEN v_cats := NULL; END; " +
        "BEGIN SELECT REPLACE(TO_CHAR(SUBSTR(sval, 1, 20)), '\"', '') INTO v_prefix FROM wms_crm_settings WHERE skey = 'PREFIX'; EXCEPTION WHEN NO_DATA_FOUND THEN v_prefix := 'CS-'; END; " +
        "IF p_post = 'Y' THEN " +
        "IF TRIM(p_subject) IS NULL OR TRIM(p_text) IS NULL OR (TRIM(p_email) IS NULL AND TRIM(p_phone) IS NULL) THEN page('Contact us', '<h1>Something is missing</h1><p class=\"m\">Please go back and fill in the subject, the description and an e-mail or phone number.</p>'); RETURN; END IF; " +
        "SELECT COUNT(*) INTO v_n FROM wms_crm_tickets WHERE channel = 'PORTAL' AND created_at > SYSDATE - 1/24 AND (LOWER(contact_email) = LOWER(TRIM(p_email)) OR contact_phone = TRIM(p_phone)); " +
        "IF v_n >= 5 THEN page('Contact us', '<h1>Thank you</h1><p class=\"m\">We already received several requests from you in the last hour; our team will be in touch.</p>'); RETURN; END IF; " +
        "v_cat := CASE WHEN v_cats IS NOT NULL AND INSTR(v_cats, '|' || p_category || '|') > 0 THEN p_category ELSE NULL END; " +
        "v_id := 'tk' || LOWER(RAWTOHEX(SYS_GUID())); v_tok := LOWER(RAWTOHEX(SYS_GUID())) || LOWER(RAWTOHEX(SYS_GUID())); " +
        "INSERT INTO wms_crm_tickets (ticket_id, ticket_no, account_number, account_name, contact_name, contact_email, contact_phone, subject, description, category, priority, status, channel, token, last_customer_at, created_by, created_at, changed_by, changed_date) " +
        "VALUES (v_id, v_prefix || LPAD(wms_crm_ticket_seq.NEXTVAL, 6, '0'), SUBSTR(TRIM(p_account), 1, 60), SUBSTR(TRIM(p_company), 1, 360), SUBSTR(TRIM(p_name), 1, 200), SUBSTR(TRIM(p_email), 1, 320), SUBSTR(TRIM(p_phone), 1, 60), SUBSTR(TRIM(p_subject), 1, 400), SUBSTR(p_text, 1, 4000), v_cat, 'P3', 'NEW', 'PORTAL', v_tok, SYSDATE, 'customer', SYSDATE, 'customer', SYSDATE) RETURNING ticket_no INTO v_no; " +
        "INSERT INTO wms_crm_ticket_events (event_id, ticket_id, kind, body, visibility, by_user, event_at) VALUES ('ev' || LOWER(RAWTOHEX(SYS_GUID())), v_id, 'CREATED', 'Raised on the customer page', 'PUBLIC', 'customer', SYSDATE); COMMIT; " +
        "page('Request received', '<h1>Thank you — we have your request</h1><p>Your reference is <b>' || HTF.escape_sc(v_no) || '</b>.</p><p class=\"m\">Keep this link to follow it and to reply: <a href=\"../t/' || v_tok || '\">see my request</a></p>'); RETURN; END IF; " +
        "IF v_cats IS NOT NULL THEN v_opts := '<label>What is it about?</label><select name=\"category\"><option value=\"\">Choose…</option>'; FOR c IN (SELECT REGEXP_SUBSTR(v_cats, '[^|]+', 1, LEVEL) AS n FROM dual CONNECT BY REGEXP_SUBSTR(v_cats, '[^|]+', 1, LEVEL) IS NOT NULL) LOOP v_opts := v_opts || '<option>' || HTF.escape_sc(c.n) || '</option>'; END LOOP; v_opts := v_opts || '</select>'; END IF; " +
        "page('Contact us', '<h1>How can we help?</h1><p class=\"m\">Tell us what happened and we will get back to you. You will get a reference number.</p><form method=\"post\">' || " +
        "'<label>Your name</label><input name=\"name\" maxlength=\"200\" required><label>E-mail</label><input name=\"email\" type=\"email\" maxlength=\"320\"><label>Phone</label><input name=\"phone\" maxlength=\"60\">' || " +
        "'<label>Company</label><input name=\"company\" maxlength=\"360\"><label>Customer account number (if you know it)</label><input name=\"account\" maxlength=\"60\">' || v_opts || " +
        "'<label>Subject</label><input name=\"subject\" maxlength=\"400\" required><label>Description</label><textarea name=\"text\" maxlength=\"4000\" required placeholder=\"Order or invoice numbers help us a lot\"></textarea><button type=\"submit\">Send my request</button></form>'); END wms_crm_portal;";
    /** crm/t/:tok — the customer's view of one ticket: status, the public conversation, reply (reopens a resolved ticket), rate it */
    C.TK_SQL = "CREATE OR REPLACE PROCEDURE wms_crm_tk (p_tok IN VARCHAR2, p_post IN VARCHAR2, p_text IN VARCHAR2, p_rate IN VARCHAR2, p_comment IN VARCHAR2) AS " +
        "v_id VARCHAR2(40); v_no VARCHAR2(30); v_subj VARCHAR2(400); v_status VARCHAR2(20); v_csat NUMBER; v_body VARCHAR2(32000); v_label VARCHAR2(60); " + HEAD +
        "BEGIN BEGIN SELECT ticket_id, ticket_no, subject, status, csat INTO v_id, v_no, v_subj, v_status, v_csat FROM wms_crm_tickets WHERE token = p_tok AND LENGTH(p_tok) >= 24; " +
        "EXCEPTION WHEN NO_DATA_FOUND THEN page('Not found', '<h1>This link is not valid</h1><p class=\"m\">It may have been copied incompletely.</p>'); RETURN; END; " +
        "IF p_post = 'Y' THEN " +
        "IF p_rate IS NOT NULL AND REGEXP_LIKE(p_rate, '^[1-5]$') AND v_csat IS NULL THEN UPDATE wms_crm_tickets SET csat = TO_NUMBER(p_rate), csat_comment = SUBSTR(p_comment, 1, 1000), csat_at = SYSDATE WHERE ticket_id = v_id; " +
        "INSERT INTO wms_crm_ticket_events (event_id, ticket_id, kind, body, visibility, by_user, event_at) VALUES ('ev' || LOWER(RAWTOHEX(SYS_GUID())), v_id, 'CSAT', 'Rated ' || p_rate || ' / 5' || NVL2(TRIM(p_comment), ': ' || SUBSTR(p_comment, 1, 1000), ''), 'PUBLIC', 'customer', SYSDATE); v_csat := TO_NUMBER(p_rate); END IF; " +
        "IF TRIM(p_text) IS NOT NULL THEN INSERT INTO wms_crm_ticket_events (event_id, ticket_id, kind, body, visibility, by_user, event_at) VALUES ('ev' || LOWER(RAWTOHEX(SYS_GUID())), v_id, 'CUSTOMER', SUBSTR(p_text, 1, 4000), 'PUBLIC', 'customer', SYSDATE); " +
        "UPDATE wms_crm_tickets SET last_customer_at = SYSDATE, status = CASE WHEN status IN ('RESOLVED', 'CLOSED', 'PENDING_CUSTOMER') THEN 'OPEN' ELSE status END, reopened_n = NVL(reopened_n, 0) + CASE WHEN status IN ('RESOLVED', 'CLOSED') THEN 1 ELSE 0 END, " +
        "resolved_at = CASE WHEN status IN ('RESOLVED', 'CLOSED') THEN NULL ELSE resolved_at END, changed_by = 'customer', changed_date = SYSDATE WHERE ticket_id = v_id; END IF; COMMIT; " +
        "SELECT status INTO v_status FROM wms_crm_tickets WHERE ticket_id = v_id; END IF; " +
        "v_label := CASE v_status WHEN 'NEW' THEN 'Received' WHEN 'OPEN' THEN 'We are working on it' WHEN 'PENDING_CUSTOMER' THEN 'Waiting for your answer' WHEN 'PENDING_INTERNAL' THEN 'We are working on it' WHEN 'RESOLVED' THEN 'Resolved' WHEN 'CLOSED' THEN 'Closed' ELSE v_status END; " +
        "v_body := '<div class=\"m\">' || HTF.escape_sc(v_no) || '</div><h1>' || HTF.escape_sc(v_subj) || '</h1><span class=\"st\">' || HTF.escape_sc(v_label) || '</span>'; " +
        "FOR e IN (SELECT kind, body, by_user, TO_CHAR(event_at, 'DD Mon YYYY HH24:MI') AS w FROM wms_crm_ticket_events WHERE ticket_id = v_id AND visibility = 'PUBLIC' AND kind IN ('CREATED', 'COMMENT', 'CUSTOMER', 'EMAIL_OUT', 'RESOLVED') ORDER BY event_at, event_id) LOOP " +
        "IF LENGTH(v_body) < 28000 THEN v_body := v_body || '<div class=\"ev' || CASE WHEN e.kind = 'CUSTOMER' THEN ' cu' END || '\"><div class=\"w\">' || CASE WHEN e.kind = 'CUSTOMER' THEN 'You' WHEN e.by_user = 'customer' THEN 'You' ELSE 'Customer care' END || ' · ' || e.w || '</div>' || REPLACE(HTF.escape_sc(SUBSTR(e.body, 1, 2000)), CHR(10), '<br>') || '</div>'; END IF; END LOOP; " +
        "v_body := v_body || '<form method=\"post\"><label>' || CASE WHEN v_status IN ('RESOLVED', 'CLOSED') THEN 'Not solved? Write to us and the request opens again' ELSE 'Add a message' END || '</label><textarea name=\"text\" maxlength=\"4000\"></textarea>'; " +
        "IF v_status IN ('RESOLVED', 'CLOSED') AND v_csat IS NULL THEN v_body := v_body || '<label>How did we do?</label><div class=\"stars\">' || '<label><input type=\"radio\" name=\"rate\" value=\"5\" style=\"width:auto\"> 5 Excellent</label><label><input type=\"radio\" name=\"rate\" value=\"4\" style=\"width:auto\"> 4 Good</label><label><input type=\"radio\" name=\"rate\" value=\"3\" style=\"width:auto\"> 3 OK</label><label><input type=\"radio\" name=\"rate\" value=\"2\" style=\"width:auto\"> 2 Poor</label><label><input type=\"radio\" name=\"rate\" value=\"1\" style=\"width:auto\"> 1 Bad</label></div><label>Comment (optional)</label><input name=\"comment\" maxlength=\"1000\">'; " +
        "ELSIF v_csat IS NOT NULL THEN v_body := v_body || '<p class=\"ok\">Thank you for your rating (' || v_csat || ' / 5).</p>'; END IF; " +
        "v_body := v_body || '<button type=\"submit\">Send</button></form>'; page(v_no, v_body); END wms_crm_tk;";
    var ORDS_SETUP = "DECLARE v_module VARCHAR2(200); BEGIN SELECT name INTO v_module FROM user_ords_modules WHERE UPPER(uri_prefix) LIKE '%WAREHOUSEMANAGEMENT%' AND ROWNUM = 1; " +
        "ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => 'crm/new/:key'); " +
        "ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'crm/new/:key', p_method => 'GET', p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_crm_portal(:key, ''N'', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL); END;'); " +
        "ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'crm/new/:key', p_method => 'POST', p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_crm_portal(:key, ''Y'', :name, :email, :phone, :account, :company, :subject, :text, :category); END;'); " +
        "ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => 'crm/t/:tok'); " +
        "ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'crm/t/:tok', p_method => 'GET', p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_crm_tk(:tok, ''N'', NULL, NULL, NULL); END;'); " +
        "ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'crm/t/:tok', p_method => 'POST', p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_crm_tk(:tok, ''Y'', :text, :rate, :comment); END;'); COMMIT; END;";
    C.portalUrl = function (key) { return D.PUBLIC + '/crm/new/' + key; };
    C.ticketUrl = function (tok) { return tok ? D.PUBLIC + '/crm/t/' + tok : ''; };
    C.linksCheck = function () {
        return D.get(C.ticketUrl('000000000000000000000000'), 30000).then(function (r) { C.linksOk = /not valid/i.test(r.text || ''); return C.linksOk; }).catch(function () { C.linksOk = false; return false; });
    };

    // ── every database object (Setup › Database objects) ──────────
    C.OBJECTS = function () {
        var out = [];
        Object.keys(C.DDL).forEach(function (t) { out.push({ kind: 'TABLE', name: t, sql: C.DDL[t] }); });
        out.push({ kind: 'SEQUENCE', name: 'WMS_CRM_TICKET_SEQ', sql: C.SEQ, help: 'ticket numbers' });
        C.INDEXES.forEach(function (d) { out.push({ kind: 'INDEX', name: (/CREATE INDEX (\w+)/i.exec(d) || [])[1].toUpperCase(), sql: d }); });
        out.push({ kind: 'PROCEDURE', name: 'WMS_CRM_PORTAL', sql: C.PORTAL_SQL, help: 'the customer page that raises a ticket' });
        out.push({ kind: 'PROCEDURE', name: 'WMS_CRM_TK', sql: C.TK_SQL, help: 'the customer\'s view of a ticket: reply, rate' });
        out.push({ kind: 'ORDS', name: 'crm/new/:key + crm/t/:tok', sql: ORDS_SETUP, help: 'REST endpoints in the WAREHOUSEMANAGEMENT module' });
        return out;
    };
    C.objects = {
        status: function () {
            var objs = C.OBJECTS(), tabs = Object.keys(C.DDL);
            var q = function (sql) { return D.rows(sql, 500).catch(function (e) { return { error: e.message }; }); };
            return Promise.all([
                q("SELECT table_name AS T FROM user_tables WHERE table_name IN ('" + tabs.join("','") + "')"),
                q("SELECT sequence_name AS T FROM user_sequences WHERE sequence_name = 'WMS_CRM_TICKET_SEQ'"),
                q("SELECT index_name AS T FROM user_indexes WHERE index_name LIKE 'WMS_CRM%'"),
                q("SELECT object_name AS T, status AS S FROM user_objects WHERE object_type = 'PROCEDURE' AND object_name IN ('WMS_CRM_PORTAL', 'WMS_CRM_TK')"),
                q("SELECT uri_template AS T FROM user_ords_templates WHERE uri_template LIKE 'crm/%'")
            ]).then(function (r) {
                var set = function (x) { var o = {}; if (Array.isArray(x)) x.forEach(function (y) { o[String(y.T).toUpperCase()] = y.S || 1; }); return o; };
                var T = set(r[0]), SQ = set(r[1]), I = set(r[2]), P = set(r[3]), O = Array.isArray(r[4]) ? r[4].map(function (x) { return x.T; }) : null;
                objs.forEach(function (o) {
                    if (o.kind === 'TABLE') { o.ok = !!T[o.name]; o.detail = o.ok ? 'exists' : 'missing'; }
                    else if (o.kind === 'SEQUENCE') { o.ok = !!SQ[o.name]; o.detail = o.ok ? 'exists' : 'missing'; }
                    else if (o.kind === 'INDEX') { o.ok = !!I[o.name]; o.detail = o.ok ? 'exists' : 'missing'; }
                    else if (o.kind === 'PROCEDURE') { o.ok = P[o.name] === 'VALID'; o.detail = !P[o.name] ? 'missing' : P[o.name] === 'VALID' ? 'valid' : 'exists but ' + String(P[o.name]).toLowerCase(); }
                    else if (o.kind === 'ORDS') {
                        if (O) { var need = ['crm/new/:key', 'crm/t/:tok'], miss = need.filter(function (n) { return O.indexOf(n) < 0; }); o.ok = !miss.length; o.detail = o.ok ? 'both endpoints defined' : 'missing: ' + miss.join(', '); }
                        else { o.ok = C.linksOk === true ? true : null; o.detail = 'ORDS views not readable here — use Check'; }
                    }
                });
                return objs;
            });
        },
        create: function (objs, force, onStep) {
            var todo = objs.filter(function (o) { return force || !o.ok; });
            return todo.reduce(function (p, o) {
                return p.then(function () {
                    o.state = 'running'; if (onStep) onStep(o);
                    var t0 = Date.now();
                    return D.write(o.sql).then(function () { o.state = 'done'; o.ok = true; o.detail = 'created ' + (Date.now() - t0) + ' ms'; },
                        function (e) {
                            var m = e.message || String(e);
                            if (/ORA-00955|ORA-01430|ORA-01408/.test(m)) { o.state = 'done'; o.ok = true; o.detail = 'already there'; return; }
                            o.state = 'failed'; o.ok = false; o.detail = m;
                        }).then(function () {
                        if (o.kind !== 'PROCEDURE' || o.state !== 'done') return;
                        return D.rows("SELECT line AS L, text AS T FROM user_errors WHERE name = '" + o.name + "' AND type = 'PROCEDURE' ORDER BY sequence", 5).then(function (er) {
                            if (er.length) { o.state = 'failed'; o.ok = false; o.detail = 'compiled with errors: line ' + er[0].L + ' ' + er[0].T; }
                        }, function () { });
                    }).then(function () { if (onStep) onStep(o); });
                });
            }, Promise.resolve()).then(function () { ensured = null; C.linksOk = null; return objs; });
        }
    };

    // ── this PC's copy (DuckDB, the WMS 2.0 file): Customer 360 sections + the phone index ──
    var DCOLS = {
        w2_crm_c360: ['pod', 'bu', 'account', 'section', 'json', 'sql_text', 'read_at'],
        w2_crm_phone: ['phone', 'last7', 'bu', 'account', 'name', 'contact', 'source', 'read_at']
    };
    C.duck = {
        put: function (table, scope, rows) {
            var dd = D.duck;
            var p = dd.io.then(function () { return dd.probe(); }).then(function (on) {
                if (!on) return null;
                var clean = (rows || []).map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { var v = r[k]; o[k] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }); return o; });
                return dd.call('w2Put', { table: table, scope: scope, rows: clean, replaceAll: false, columns: DCOLS[table] || [] }, 300000).then(function (d) { if (d && d.ok === false) throw new Error(d.error || 'DuckDB write failed'); return d; });
            });
            dd.io = p.catch(function (e) { console.warn('[CRM] DuckDB:', e && e.message || e); });
            return p.catch(function () { return null; });
        },
        qs: function (list) { return D.duck.qs(list); },
        lit: function (v) { return D.duck.lit(v); },
        /** the kept 360 sections of one customer → {section: {rows, sql, at}} */
        c360: function (pod, bu, account) {
            var L = C.duck.lit;
            return C.duck.qs(['SELECT section, json, sql_text, read_at FROM w2_crm_c360 WHERE pod = ' + L(pod) + ' AND bu = ' + L(bu) + ' AND account = ' + L(account)]).then(function (r) {
                var out = {}; (r[0] || []).forEach(function (x) { try { out[x.section] = { rows: JSON.parse(x.json), sql: x.sql_text, at: x.read_at, local: true }; } catch (e) { } });
                return out;
            });
        },
        keep360: function (pod, bu, account, section, rows, sql) {
            return C.duck.put('w2_crm_c360', { pod: pod, bu: bu, account: account, section: section }, [{ pod: pod, bu: bu, account: account, section: section, json: JSON.stringify(rows || []), sql_text: sql || '', read_at: C.now() }]);
        },
        phones: function () { return C.duck.qs(['SELECT phone, last7, bu, account, name, contact, source FROM w2_crm_phone']).then(function (r) { return r[0] || []; }); }
    };
})(window);

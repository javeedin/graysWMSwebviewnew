/* Customer CRM · APEX + DuckDB layer (window.CRMS), built on the Debtors store (../debtors/dc-store.js = DCS: the host bridge,
 * the ai/executequery | executewrite gateway, CLOB helpers, Fusion SQL, the DuckDB file). Tables are created on first use;
 * the same DDL is in apex_sql/100_crm.sql, and Setup › Database objects shows / creates every object.
 *   WMS_CRM_SETTINGS       JSON per key (SETUP = categories, queues, agents, SLA, business hours, rules, canned replies, phone)
 *   WMS_CRM_TICKETS        one row per ticket (number CS-000123 from WMS_CRM_TICKET_SEQ, SLA due dates, token for the customer page)
 *   WMS_CRM_TICKET_EVENTS  the ticket's conversation and history (public replies, internal notes, status, assignment, customer)
 *   WMS_CRM_CALLS          every call in / out: number, customer, agent, times, outcome, notes, recording file + SHA-256, callback
 *   WMS_CRM_MESSAGES       every e-mail sent from the CRM (to, subject, attachments with their fingerprints, ticket, statement)
 *   WMS_CRM_CONTACTS       people at the customer kept by the CRM (beside the Fusion contacts)
 *   WMS_CRM_C360           the Customer 360 Fusion sections as last read (rows JSON + the SQL) — every PC opens a customer at once
 *   WMS_CRM_CUSTOMERS      the whole Fusion customer master (Customers › Load all Fusion customers / Sync changes), shared by every PC
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
    var DATES = ['CREATED_AT', 'CHANGED_AT', 'DUE_FIRST', 'DUE_RESOLVE', 'FIRST_RESPONSE_AT', 'RESOLVED_AT', 'CLOSED_AT', 'PAUSED_AT', 'EVENT_AT', 'STARTED_AT', 'ANSWERED_AT', 'ENDED_AT', 'CALLBACK_AT', 'SENT_AT', 'CSAT_AT', 'LAST_CUSTOMER_AT', 'PINNED_AT'];
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
            "is_primary VARCHAR2(1) DEFAULT 'N', notes VARCHAR2(1000), removed VARCHAR2(1) DEFAULT 'N', created_by VARCHAR2(100), created_at DATE DEFAULT SYSDATE, changed_by VARCHAR2(100), changed_date DATE DEFAULT SYSDATE)",
        WMS_CRM_C360: 'CREATE TABLE wms_crm_c360 (c360_id VARCHAR2(300) PRIMARY KEY, pod VARCHAR2(20), bu_id VARCHAR2(30), account_number VARCHAR2(60), section VARCHAR2(30), rows_n NUMBER, cut_n NUMBER, ' +
            'rows_json CLOB, sql_text CLOB, read_by VARCHAR2(100), read_at DATE DEFAULT SYSDATE)',
        WMS_CRM_CUSTOMERS: 'CREATE TABLE wms_crm_customers (pod VARCHAR2(20) NOT NULL, account_number VARCHAR2(60) NOT NULL, cust_account_id NUMBER, customer VARCHAR2(360), party_number VARCHAR2(60), account_name VARCHAR2(360), ' +
            'status VARCHAR2(10), customer_type VARCHAR2(30), customer_class VARCHAR2(60), tax_reference VARCHAR2(100), bill_to_address VARCHAR2(1000), email VARCHAR2(320), phone VARCHAR2(400), phone_digits VARCHAR2(200), ' +
            'changed VARCHAR2(20), hay VARCHAR2(4000), dff_json VARCHAR2(4000), read_at DATE DEFAULT SYSDATE, CONSTRAINT wms_crm_customers_pk PRIMARY KEY (pod, account_number))',
        WMS_CRM_PINS: 'CREATE TABLE wms_crm_pins (app_user VARCHAR2(100) NOT NULL, pod VARCHAR2(20) NOT NULL, account_number VARCHAR2(60) NOT NULL, bu_id VARCHAR2(30), account_name VARCHAR2(360), note VARCHAR2(1000), ' +
            'sort_n NUMBER, pinned_at DATE DEFAULT SYSDATE, CONSTRAINT wms_crm_pins_pk PRIMARY KEY (app_user, pod, account_number))'
    };
    C.SEQ = 'CREATE SEQUENCE wms_crm_ticket_seq START WITH 1 INCREMENT BY 1 NOCACHE';
    C.INDEXES = [
        'CREATE INDEX wms_crm_tk_acct ON wms_crm_tickets (account_number)', 'CREATE INDEX wms_crm_tk_status ON wms_crm_tickets (status)', 'CREATE INDEX wms_crm_tk_tok ON wms_crm_tickets (token)',
        'CREATE INDEX wms_crm_ev_tk ON wms_crm_ticket_events (ticket_id)', 'CREATE INDEX wms_crm_call_acct ON wms_crm_calls (account_number)', 'CREATE INDEX wms_crm_call_e164 ON wms_crm_calls (number_e164)',
        'CREATE INDEX wms_crm_msg_acct ON wms_crm_messages (account_number)', 'CREATE INDEX wms_crm_ct_acct ON wms_crm_contacts (account_number)',
        'CREATE INDEX wms_crm_c360_acct ON wms_crm_c360 (pod, account_number)', 'CREATE INDEX wms_crm_cust_ph ON wms_crm_customers (pod, phone_digits)', 'CREATE INDEX wms_crm_cust_id ON wms_crm_customers (pod, cust_account_id)'
    ];
    /** columns added after the first release of a table → run on an older table (ALTER, never DROP) */
    C.UPGRADES = [
        { table: 'WMS_CRM_CUSTOMERS', column: 'DFF_JSON', sql: ['ALTER TABLE wms_crm_customers ADD (dff_json VARCHAR2(4000))', 'ALTER TABLE wms_crm_customers MODIFY (phone VARCHAR2(400), phone_digits VARCHAR2(200), hay VARCHAR2(4000))'] }
    ];
    function upgrade() {
        return D.rows("SELECT table_name AS T, column_name AS C FROM user_tab_columns WHERE table_name IN ('" + C.UPGRADES.map(function (u) { return u.table; }).join("','") + "')", 2000).then(function (r) {
            var have = {}; r.forEach(function (x) { have[String(x.T).toUpperCase() + '.' + String(x.C).toUpperCase()] = 1; });
            return C.UPGRADES.filter(function (u) { return !have[u.table + '.' + u.column]; }).reduce(function (p, u) {
                return p.then(function () { return u.sql.reduce(function (q, x) { return q.then(function () { return D.write(x).catch(function (e) { console.warn('[CRM] upgrade:', e && e.message); }); }); }, Promise.resolve()); });
            }, Promise.resolve());
        }).catch(function (e) { console.warn('[CRM] upgrade check:', e && e.message); });
    }
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
                .then(upgrade)
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

    // ── pinned customers: one list per agent (app login) and pod; APEX is the record, this PC keeps a copy in DuckDB ──
    var PN = ['APP_USER', 'POD', 'ACCOUNT_NUMBER', 'BU_ID', 'ACCOUNT_NAME', 'NOTE', 'SORT_N', 'PINNED_AT'];
    C.pins = {
        list: function (pod, user) {
            user = user || D.user();
            return C.ensure().then(function () { return D.rowsAll('SELECT ' + cols(PN) + ' FROM wms_crm_pins WHERE app_user = ' + lit(user) + ' AND pod = ' + lit(pod) + ' ORDER BY sort_n, pinned_at DESC', 2000); }).then(loc);
        },
        add: function (pod, p) {
            var me = lit(D.user());
            return C.ensure().then(function () {
                return D.write('INSERT INTO wms_crm_pins (app_user, pod, account_number, bu_id, account_name, note, sort_n, pinned_at) SELECT ' + [me, lit(pod), lit(p.account, 60), lit(p.bu, 30), lit(p.name, 360), lit(p.note, 1000), num(p.sort || 0), 'SYSDATE'].join(', ') +
                    ' FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_crm_pins WHERE app_user = ' + me + ' AND pod = ' + lit(pod) + ' AND account_number = ' + lit(p.account, 60) + ')');
            });
        },
        set: function (pod, account, sets) { return D.write('UPDATE wms_crm_pins SET ' + setList(sets) + ' WHERE app_user = ' + lit(D.user()) + ' AND pod = ' + lit(pod) + ' AND account_number = ' + lit(account)); },
        remove: function (pod, account) { return D.write('DELETE FROM wms_crm_pins WHERE app_user = ' + lit(D.user()) + ' AND pod = ' + lit(pod) + ' AND account_number = ' + lit(account)); }
    };

    // ── Customer 360 sections in APEX: what one PC read from Fusion, every PC opens at once ──
    C.C360_CAP = 250000;                                            // characters of rows JSON kept per section (the rest is cut, cut_n says how many rows)
    var c360q = Promise.resolve();
    C.c360 = {
        id: function (pod, bu, account, section) { return [pod, bu || '', account, section].join('|'); },
        /** {section: {rows, sql, at, by, cut, apex: true}} of one customer */
        get: function (pod, bu, account, skip) {
            var where = ' WHERE pod = ' + lit(pod) + ' AND bu_id ' + (bu ? '= ' + lit(bu) : 'IS NULL') + ' AND account_number = ' + lit(account);
            return C.ensure().then(function () {
                return D.rows('SELECT c360_id AS ID, section AS SECTION, rows_n AS N, cut_n AS CUT, read_by AS READ_BY, TO_CHAR(read_at, ' + TS + ') AS READ_AT FROM wms_crm_c360' + where, 100);
            }).then(function (meta) {
                meta = meta.filter(function (m) { return !skip || skip.indexOf(m.SECTION) < 0; });
                if (!meta.length) return {};
                // one section at a time: a section being rewritten by another read (or another PC) at this moment is skipped, not the whole customer
                var out = {};
                return meta.reduce(function (p, m) {
                    return p.then(function () {
                        return Promise.all([D.readClob('wms_crm_c360', 'rows_json', 'c360_id', [m.ID]), D.readClob('wms_crm_c360', 'sql_text', 'c360_id', [m.ID])]).then(function (r) {
                            var rows; try { rows = JSON.parse(r[0][m.ID] || '[]'); } catch (e) { return; }
                            out[m.SECTION] = { rows: rows, sql: r[1][m.ID] || '', at: D.local(m.READ_AT), by: m.READ_BY, cut: +m.CUT || 0, apex: true };
                        }, function (e) { console.warn('[CRM] APEX 360 ' + m.SECTION + ' skipped:', e && e.message || e); });
                    });
                }, Promise.resolve()).then(function () { return out; });
            });
        },
        /** keep one section (queued: one write at a time, never in the user's way) */
        put: function (pod, bu, account, section, rows, sql) {
            var id = C.c360.id(pod, bu, account, section), all = rows || [], fit = D.fitRows(all, 20000, C.C360_CAP), me = lit(D.user());
            var p = c360q.then(function () { return C.ensure(); }).then(function () {
                return D.write('MERGE INTO wms_crm_c360 t USING (SELECT ' + lit(id) + ' AS c360_id FROM dual) s ON (t.c360_id = s.c360_id) WHEN MATCHED THEN UPDATE SET rows_n = ' + all.length + ', cut_n = ' + (all.length - fit.length) +
                    ', read_by = ' + me + ', read_at = SYSDATE WHEN NOT MATCHED THEN INSERT (c360_id, pod, bu_id, account_number, section, rows_n, cut_n, rows_json, sql_text, read_by, read_at) VALUES (' +
                    [lit(id), lit(pod), lit(bu), lit(account, 60), lit(section), all.length, all.length - fit.length, 'EMPTY_CLOB()', 'EMPTY_CLOB()', me, 'SYSDATE'].join(', ') + ')');
            }).then(function () { return D.writeClob('wms_crm_c360', 'rows_json', 'c360_id = ' + lit(id), JSON.stringify(fit)); })
                .then(function () { return D.writeClob('wms_crm_c360', 'sql_text', 'c360_id = ' + lit(id), sql || ''); })
                .then(function () { return { ok: true, rows: fit.length, cut: all.length - fit.length }; });
            c360q = p.catch(function (e) { console.warn('[CRM] APEX 360:', e && e.message || e); });
            return p;
        }
    };

    // ── the whole Fusion customer master in APEX (shared by every PC) ──
    C.CUST_COLS = ['pod', 'account_number', 'cust_account_id', 'customer', 'party_number', 'account_name', 'status', 'customer_type', 'customer_class', 'tax_reference', 'bill_to_address', 'email', 'phone', 'phone_digits', 'changed', 'hay', 'dff_json'];
    var CUST_LEN = { pod: 20, account_number: 60, customer: 360, party_number: 60, account_name: 360, status: 10, customer_type: 30, customer_class: 60, tax_reference: 100, bill_to_address: 1000, email: 320, phone: 400, phone_digits: 200, changed: 20, hay: 4000, dff_json: 4000 };
    /** cut a text to fit a VARCHAR2(n) column measured in BYTES (accents / non-Latin names take 2–4 bytes; a too-long value = ORA-12899) */
    function fitBytes(v, max) {
        var s = v == null ? '' : String(v), b = 0, i = 0;
        for (; i < s.length; i++) {
            var c = s.charCodeAt(i), w = c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c <= 0xDBFF) ? 4 : 3;
            if (b + w > max) break;
            b += w; if (w === 4) i++;
        }
        return s.slice(0, i);
    }
    C.fitBytes = fitBytes;
    function custSel(r) { return 'SELECT ' + C.CUST_COLS.map(function (k) { return (k === 'cust_account_id' ? num(r[k]) : lit(fitBytes(r[k], CUST_LEN[k]))) + ' AS ' + k; }).join(', ') + ' FROM dual'; }
    var CUST_READ = C.CUST_COLS.filter(function (k) { return k !== 'pod'; }).map(function (k) { return k + ' AS ' + k.toUpperCase(); }).join(', ');
    function lower(rows) { return rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toLowerCase()] = r[k] == null ? '' : String(r[k]); }); return o; }); }
    C.customers = {
        /** how many are kept for the pod, the newest change, when the last row was written */
        status: function (pod) {
            return C.ensure().then(function () { return D.rows('SELECT COUNT(*) AS N, MAX(changed) AS MC, MAX(cust_account_id) AS MAXID, TO_CHAR(MAX(read_at), ' + TS + ') AS RA FROM wms_crm_customers WHERE pod = ' + lit(pod), 2); })
                .then(function (r) { var x = r[0] || {}; return { n: +x.N || 0, maxChanged: x.MC || '', maxId: x.MAXID || '', at: x.RA ? D.local(x.RA) : '' }; });
        },
        /** upsert rows (E.custRow shape), 40 per MERGE; onStep(done) */
        /** upsert rows (E.custRow shape), 40 per MERGE; a failing statement is retried as 4 × 10, then row by row, so one bad
         *  row never stops the rest → {done, failed, error}; onStep(done, failed) */
        merge: function (pod, rows, onStep) {
            var sets = C.CUST_COLS.filter(function (k) { return k !== 'pod' && k !== 'account_number'; });
            var res = { done: 0, failed: 0, error: null };
            function sql(g) {
                return 'MERGE INTO wms_crm_customers t USING (' + g.map(function (r) { return custSel(Object.assign({}, r, { pod: pod })); }).join(' UNION ALL ') + ') s ON (t.pod = s.pod AND t.account_number = s.account_number)' +
                    ' WHEN MATCHED THEN UPDATE SET ' + sets.map(function (k) { return 't.' + k + ' = s.' + k; }).join(', ') + ', t.read_at = SYSDATE' +
                    ' WHEN NOT MATCHED THEN INSERT (' + C.CUST_COLS.join(', ') + ', read_at) VALUES (' + C.CUST_COLS.map(function (k) { return 's.' + k; }).join(', ') + ', SYSDATE)';
            }
            function one(g, size) {
                return D.write(sql(g)).then(function () { res.done += g.length; if (onStep) onStep(res.done, res.failed); }, function (e) {
                    if (g.length === 1) { res.failed++; res.error = (e && e.message || String(e)) + ' (account ' + g[0].account_number + ')'; if (onStep) onStep(res.done, res.failed); return; }
                    var next = size > 10 ? 10 : 1, parts = []; for (var i = 0; i < g.length; i += next) parts.push(g.slice(i, i + next));
                    return parts.reduce(function (p, x) { return p.then(function () { return one(x, next); }); }, Promise.resolve());
                });
            }
            var groups = []; for (var i = 0; i < rows.length; i += 40) groups.push(rows.slice(i, i + 40));
            return C.ensure().then(function () { return groups.reduce(function (p, g) { return p.then(function () { return one(g, 40); }); }, Promise.resolve()); }).then(function () { return res; });
        },
        /** one page of the APEX copy (no DuckDB on this PC) → {rows, total} */
        page: function (pod, q, size, offset) {
            var w = q ? root.CRME.custWhere(q, function (v) { return lit(v); }) : '';
            var where = ' FROM wms_crm_customers WHERE pod = ' + lit(pod) + (w ? ' AND ' + w : '');
            return C.ensure().then(function () {
                return Promise.all([D.rows('SELECT COUNT(*) AS N' + where, 2), D.rows('SELECT ' + CUST_READ + where + ' ORDER BY customer, account_number OFFSET ' + (+offset || 0) + ' ROWS FETCH NEXT ' + (+size || 50) + ' ROWS ONLY', +size || 50)]);
            }).then(function (r) { return { rows: lower(r[1]), total: +(r[0][0] || {}).N || 0 }; });
        },
        /** every kept customer of the pod (to fill this PC's DuckDB copy) */
        all: function (pod, max) { return C.ensure().then(function () { return D.rowsAll('SELECT ' + CUST_READ + ' FROM wms_crm_customers WHERE pod = ' + lit(pod) + ' ORDER BY account_number', max || 300000); }).then(lower); },
        /** search the APEX copy (when this PC has no DuckDB) */
        search: function (pod, q, max) {
            var w = root.CRME.custWhere(q, function (v) { return lit(v); }); if (!w) return Promise.resolve([]);
            return C.ensure().then(function () { return D.rows('SELECT ' + CUST_READ + ' FROM wms_crm_customers WHERE pod = ' + lit(pod) + ' AND ' + w + ' ORDER BY customer FETCH FIRST ' + (max || 100) + ' ROWS ONLY', max || 100); }).then(lower);
        }
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
        w2_crm_phone: ['phone', 'last7', 'bu', 'account', 'name', 'contact', 'source', 'read_at'],
        w2_crm_drill: ['pod', 'dkey', 'part', 'json', 'sql_text', 'read_at'],
        w2_crm_pins: ['app_user', 'pod', 'account_number', 'bu_id', 'account_name', 'note', 'sort_n', 'pinned_at'],
        w2_crm_customers: ['pod', 'account_number', 'cust_account_id', 'customer', 'party_number', 'account_name', 'status', 'customer_type', 'customer_class', 'tax_reference', 'bill_to_address', 'email', 'phone', 'phone_digits', 'changed', 'hay', 'dff_json', 'read_at']
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
        phones: function () { return C.duck.qs(['SELECT phone, last7, bu, account, name, contact, source FROM w2_crm_phone']).then(function (r) { return r[0] || []; }); },
        /** the parts of one drill-down kept on this PC → {part: {rows, sql, at, local}} */
        drill: function (pod, key) {
            var L = C.duck.lit;
            return C.duck.qs(['SELECT part, json, sql_text, read_at FROM w2_crm_drill WHERE pod = ' + L(pod) + ' AND dkey = ' + L(key)]).then(function (r) {
                var out = {}; (r[0] || []).forEach(function (x) { try { out[x.part] = { rows: JSON.parse(x.json), sql: x.sql_text, at: x.read_at, local: true }; } catch (e) { } });
                return out;
            }, function () { return {}; });
        },
        keepDrill: function (pod, key, part, rows, sql) {
            return C.duck.put('w2_crm_drill', { pod: pod, dkey: key, part: part }, [{ pod: pod, dkey: key, part: part, json: JSON.stringify(rows || []), sql_text: sql || '', read_at: C.now() }]);
        },
        /** the customer master kept on this PC */
        custStatus: function (pod) {
            var L = C.duck.lit(pod);
            return C.duck.qs(["SELECT COUNT(*) AS n, MAX(changed) AS mc, MAX(read_at) AS ra, COUNT(CASE WHEN dff_json <> '' THEN 1 END) AS nd FROM w2_crm_customers WHERE pod = " + L])
                .catch(function () { return C.duck.qs(['SELECT COUNT(*) AS n, MAX(changed) AS mc, MAX(read_at) AS ra FROM w2_crm_customers WHERE pod = ' + L]); })
                .then(function (r) { var x = (r[0] || [])[0] || {}; return { n: +x.n || 0, maxChanged: x.mc || '', at: x.ra || '', nd: x.nd == null ? 0 : +x.nd }; });
        },
        custPut: function (pod, rows) {
            var now = C.now();
            return C.duck.put('w2_crm_customers', { pod: pod, account_number: rows.map(function (r) { return r.account_number; }) }, rows.map(function (r) { return Object.assign({}, r, { pod: pod, read_at: now }); }));
        },
        custSearch: function (pod, q, max) {
            var w = root.CRME.custWhere(q, C.duck.lit); if (!w) return Promise.resolve([]);
            return C.duck.qs(['SELECT * FROM w2_crm_customers WHERE pod = ' + C.duck.lit(pod) + ' AND ' + w + ' ORDER BY customer LIMIT ' + (max || 100)]).then(function (r) { return r[0] || []; });
        },
        /** one page of this PC's copy, all customers or the ones matching q → {rows, total} */
        custPage: function (pod, q, size, offset) {
            var L = C.duck.lit, w = q ? root.CRME.custWhere(q, L) : '', where = ' FROM w2_crm_customers WHERE pod = ' + L(pod) + (w ? ' AND ' + w : '');
            return C.duck.qs(['SELECT COUNT(*) AS n' + where, 'SELECT *' + where + ' ORDER BY customer, account_number LIMIT ' + (+size || 50) + ' OFFSET ' + (+offset || 0)]).then(function (r) {
                return { rows: r[1] || [], total: +((r[0] || [])[0] || {}).n || 0 };
            });
        },
        /** this PC's copy in pages (for the copy to APEX) */
        custChunk: function (pod, size, offset) {
            return C.duck.qs(['SELECT * FROM w2_crm_customers WHERE pod = ' + C.duck.lit(pod) + ' ORDER BY account_number LIMIT ' + size + ' OFFSET ' + offset]).then(function (r) { return r[0] || []; });
        },
        /** this agent's pins as kept on this PC (shown at once, APEX read after) */
        pins: function (pod, user) {
            var L = C.duck.lit;
            return C.duck.qs(['SELECT * FROM w2_crm_pins WHERE app_user = ' + L(user || D.user()) + ' AND pod = ' + L(pod) + ' ORDER BY sort_n, pinned_at DESC']).then(function (r) {
                return (r[0] || []).map(function (x) { return { APP_USER: x.app_user, POD: x.pod, ACCOUNT_NUMBER: x.account_number, BU_ID: x.bu_id, ACCOUNT_NAME: x.account_name, NOTE: x.note, SORT_N: +x.sort_n || 0, PINNED_AT: x.pinned_at, local: true }; });
            }, function () { return null; });
        },
        /** the whole list of one agent × pod replaces what this PC had */
        keepPins: function (pod, list, user) {
            user = user || D.user();
            return C.duck.put('w2_crm_pins', { app_user: user, pod: pod }, (list || []).map(function (p) { return { app_user: user, pod: pod, account_number: p.ACCOUNT_NUMBER, bu_id: p.BU_ID || '', account_name: p.ACCOUNT_NAME || '', note: p.NOTE || '', sort_n: p.SORT_N || 0, pinned_at: p.PINNED_AT || '' }; }));
        },
        custByPhone: function (pod, last7) {
            if (!/^\d{7}$/.test(last7 || '')) return Promise.resolve([]);
            return C.duck.qs(["SELECT * FROM w2_crm_customers WHERE pod = " + C.duck.lit(pod) + " AND phone_digits LIKE '%" + last7 + "%' LIMIT 20"]).then(function (r) { return r[0] || []; });
        }
    };
})(window);

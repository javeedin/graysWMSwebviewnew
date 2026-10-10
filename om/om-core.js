/* Order Management — core: host bridge, APEX storage (tables created on first use), settings, lookup sources.
   Transport: APEX ai/executequery + ai/executewrite through the host's executePost relay; Fusion lookups through
   BI Publisher reports (host action omBip — credentials stay in C#) or the Fusion SQL runner (fusionSqlExecute,
   read-only); Fusion order REST through omRest (salesOrdersForOrderHub only). */

var OM_APEX = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
var OM_FUSION = { PROD: 'https://efmh.fa.em3.oraclecloud.com', TEST: 'https://efmh-test.fa.em3.oraclecloud.com' };
var OM_PIECE = 1300;

var OM = {
    user: '', instance: 'PROD', ready: false,
    settings: { BUS: null, GENERAL: null, SOURCES: null, LAYOUTS: null },
    me: null,              // WMS_OM_USERS row
    bu: null,              // chosen business unit
    lookups: {},           // cached lookup rows per key + BU
    prices: {},            // { 'PRICE_LIST|DATE': { items:[], byCode:{} } }
    rules: null            // discount rules (normalised)
};

// ── small utils ────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function toast(t, kind) { var el = $('toast'); el.textContent = t; el.className = 'toast ' + (kind || ''); el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { el.style.display = 'none'; }, kind === 'err' ? 7000 : 3800); }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
function hasHost() { return !!(window.chrome && window.chrome.webview); }
function omInstance() {
    var v = null;
    try { v = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || localStorage.getItem('instanceName'); } catch (e) { }
    v = (v || 'PROD').toUpperCase(); return v === 'TEST' ? 'TEST' : 'PROD';
}
function omAppUser() {
    try { return (sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || localStorage.getItem('userName') || localStorage.getItem('username') || 'UNKNOWN').toUpperCase(); }
    catch (e) { return 'UNKNOWN'; }
}
function fmtMoney(n, p) { n = +n || 0; return n.toLocaleString(undefined, { minimumFractionDigits: p == null ? 2 : p, maximumFractionDigits: p == null ? 2 : p }); }
function fmtQty(n) { n = +n || 0; return Math.round(n * 1000) / 1000 + ''; }
function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function omAgo(s) {
    if (!s) return '';
    var d = new Date(String(s).replace(' ', 'T')); if (isNaN(d)) return s;
    var m = Math.round((Date.now() - d) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
}
function omSeq(list, fn) { return list.reduce(function (p, x, i) { return p.then(function () { return fn(x, i); }); }, Promise.resolve()); }
function omCsv(list) { return (list || []).map(function (s) { return String(s).trim(); }).filter(Boolean); }
function omIn(list, max) { return (list || []).slice(0, max || 900).map(function (v) { return "'" + String(v).replace(/'/g, "''") + "'"; }).join(',') || "''"; }

// ── host bridge ────────────────────────────────────────────────
var _omPending = {}, _omProgress = {};
function host(action, payload, onProgress) {
    return new Promise(function (resolve, reject) {
        if (!hasHost()) { reject('Open this page inside the Gray\'s WMS app.'); return; }
        var id = 'om_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        _omPending[id] = { resolve: resolve, reject: reject };
        if (onProgress) _omProgress[id] = onProgress;
        window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, instance: OM.instance, appUser: OM.user }, payload || {}));
    });
}
if (hasHost()) {
    window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r || !r.requestId || !_omPending[r.requestId]) return;
        if (r.action === 'omProgress' || r.action === 'fusionSqlAiProgress') { if (_omProgress[r.requestId]) _omProgress[r.requestId](r); return; }
        var cb = _omPending[r.requestId]; delete _omPending[r.requestId]; delete _omProgress[r.requestId];
        if (r.action === 'error') cb.reject(r.message || 'Host error'); else cb.resolve(r.data == null ? r : r.data);
    });
}

// ── APEX ───────────────────────────────────────────────────────
function omApex(path, payload) {
    return host('executePost', { fullUrl: OM_APEX + path, body: JSON.stringify(Object.assign({ appUser: OM.user }, payload)) }).then(function (data) {
        var d = data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { throw 'Unexpected response from the database API: ' + String(data).slice(0, 200); } }
        if (!d || d.success === false || d.ReturnStatus === 'Error') throw (d && (d.error || d.ErrorExplanation)) || 'Database API error';
        return d;
    });
}
function omRead(sql, maxRows) {
    return omApex('/executequery', { sql: sql, maxRows: Math.min(maxRows || 500, 1000) }).then(function (d) {
        var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
        return (d.rows || []).map(function (r) {
            if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
            var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
        });
    });
}
function omWrite(sql) { return omApex('/executewrite', { sql: sql }); }
function omLit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function omV(s, max) { s = String(s == null ? '' : s).slice(0, max || 4000); return s ? omLit(s) : 'NULL'; }
function omN(n) { return n == null || n === '' || isNaN(n) ? 'NULL' : String(+n); }
function omD(s) { return s ? "TO_DATE(" + omLit(String(s).slice(0, 10)) + ", 'YYYY-MM-DD')" : 'NULL'; }
function omClob(s) {
    s = String(s == null ? '' : s);
    if (!s) return 'EMPTY_CLOB()';
    var parts = [];
    for (var i = 0; i < s.length; i += OM_PIECE) parts.push('TO_CLOB(' + omLit(s.slice(i, i + OM_PIECE)) + ')');
    return parts.join(' || ');
}
/** Large CLOB writes: the first piece in the statement, the rest appended in batches (statement size limit). */
function omWriteClob(table, col, where, text) {
    text = String(text || '');
    var CH = 60000, first = text.slice(0, CH);
    return omWrite('UPDATE ' + table + ' SET ' + col + ' = ' + omClob(first) + ' WHERE ' + where).then(function () {
        var rest = []; for (var i = CH; i < text.length; i += CH) rest.push(text.slice(i, i + CH));
        return omSeq(rest, function (part) { return omWrite('UPDATE ' + table + ' SET ' + col + ' = ' + col + ' || ' + omClob(part) + ' WHERE ' + where); });
    });
}
function omPieces(col, n, from) {
    var a = [];
    for (var i = 0; i < n; i++) a.push('TO_CHAR(SUBSTR(' + col + ', ' + ((from || 1) + i * OM_PIECE) + ', ' + OM_PIECE + ')) AS ' + col + '_' + i);
    return a.join(', ');
}
function omJoinPieces(row, col, n) { var s = ''; for (var i = 0; i < n; i++) s += row[(col + '_' + i).toUpperCase()] || ''; return s; }
function omReadClob(table, col, where) {
    return omRead('SELECT NVL(LENGTH(' + col + '), 0) AS len FROM ' + table + ' WHERE ' + where, 1).then(function (r) {
        var len = r.length ? +r[0].LEN : 0, out = '', offs = [];
        for (var o = 1; o <= len; o += OM_PIECE * 12) offs.push(o);
        return omSeq(offs, function (o) {
            return omRead('SELECT ' + omPieces(col, 12, o) + ' FROM ' + table + ' WHERE ' + where, 1).then(function (x) { out += omJoinPieces(x[0] || {}, col, 12); });
        }).then(function () { return out; });
    });
}
function omJson(s, d) { if (!s) return d; try { return JSON.parse(s); } catch (e) { return d; } }

var OM_DDL = [
    ['WMS_OM_SETTINGS', 'CREATE TABLE wms_om_settings (setting_key VARCHAR2(60) PRIMARY KEY, setting_value CLOB, updated_by VARCHAR2(120), updated_date DATE DEFAULT SYSDATE)'],
    ['WMS_OM_USERS', 'CREATE TABLE wms_om_users (app_user VARCHAR2(120) PRIMARY KEY, bu_name VARCHAR2(120), warehouse VARCHAR2(120), subinventory VARCHAR2(60), salesrep_name VARCHAR2(200), ' +
        'salesrep_id VARCHAR2(40), price_list VARCHAR2(200), order_prefix VARCHAR2(20), next_no NUMBER DEFAULT 1, prefs_json CLOB, updated_by VARCHAR2(120), updated_date DATE DEFAULT SYSDATE)'],
    ['WMS_OM_ORDERS', "CREATE TABLE wms_om_orders (order_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_no VARCHAR2(60) NOT NULL, bu_name VARCHAR2(120), instance VARCHAR2(10) DEFAULT 'PROD', " +
        "status VARCHAR2(30) DEFAULT 'DRAFT', verdict VARCHAR2(20), customer_number VARCHAR2(60), customer_name VARCHAR2(360), order_type VARCHAR2(120), customer_po VARCHAR2(120), order_date DATE, currency VARCHAR2(10), " +
        'total_net NUMBER, total_tax NUMBER, total_disc NUMBER, line_count NUMBER, header_json CLOB, lines_json CLOB, fusion_header_id VARCHAR2(40), fusion_order_no VARCHAR2(60), fusion_status VARCHAR2(60), ' +
        'last_error VARCHAR2(4000), created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120), updated_date DATE DEFAULT SYSDATE, submitted_by VARCHAR2(120), submitted_date DATE, ' +
        'CONSTRAINT wms_om_orders_uk UNIQUE (order_no, instance))'],
    ['WMS_OM_EVENTS', 'CREATE TABLE wms_om_events (event_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id NUMBER NOT NULL, event_type VARCHAR2(40), detail VARCHAR2(4000), data_json CLOB, created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE)'],
    ['WMS_OM_APPROVALS', "CREATE TABLE wms_om_approvals (approval_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id NUMBER NOT NULL, order_no VARCHAR2(60), reason VARCHAR2(4000), amount NUMBER, " +
        "requested_by VARCHAR2(120), requested_date DATE DEFAULT SYSDATE, status VARCHAR2(20) DEFAULT 'PENDING', decided_by VARCHAR2(120), decided_date DATE, note VARCHAR2(1000))"],
    ['WMS_OM_DISCOUNTS', "CREATE TABLE wms_om_discounts (rule_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ctx VARCHAR2(20) DEFAULT 'CUSTOMER', disc_level VARCHAR2(30), target VARCHAR2(200) DEFAULT 'ALL', " +
        "pct NUMBER DEFAULT 0, valid_from DATE, valid_to DATE, excl VARCHAR2(1) DEFAULT 'N', disc_ref VARCHAR2(200), cust_no VARCHAR2(60), cust_cat VARCHAR2(120), min_qty NUMBER, max_qty NUMBER, active VARCHAR2(1) DEFAULT 'Y', " +
        "source VARCHAR2(20) DEFAULT 'MANUAL', updated_by VARCHAR2(120), updated_date DATE DEFAULT SYSDATE)"],
    ['WMS_OM_BACKORDERS', "CREATE TABLE wms_om_backorders (backorder_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_no VARCHAR2(60), customer_number VARCHAR2(60), customer_name VARCHAR2(360), item VARCHAR2(100), " +
        "item_desc VARCHAR2(400), qty NUMBER, warehouse VARCHAR2(120), status VARCHAR2(20) DEFAULT 'OPEN', created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE)"]
];
var OM_INDEXES = ['CREATE INDEX wms_om_events_n1 ON wms_om_events (order_id)', 'CREATE INDEX wms_om_approvals_n1 ON wms_om_approvals (status)',
    'CREATE INDEX wms_om_discounts_n1 ON wms_om_discounts (cust_no)', 'CREATE INDEX wms_om_discounts_n2 ON wms_om_discounts (cust_cat)'];
var _omEnsured = null;
function omEnsureTables() {
    if (_omEnsured) return _omEnsured;
    _omEnsured = omRead("SELECT table_name FROM user_tables WHERE table_name LIKE 'WMS\\_OM\\_%' ESCAPE '\\'", 50).then(function (r) {
        var have = {}; r.forEach(function (x) { have[x.TABLE_NAME] = 1; });
        var todo = OM_DDL.filter(function (t) { return !have[t[0]]; });
        if (!todo.length) return;
        toast('Creating the Order Management tables in APEX…');
        return omSeq(todo, function (t) { return omWrite(t[1]); }).then(function () {
            return omSeq(OM_INDEXES, function (s) { return omWrite(s).catch(function () { }); });
        });
    }).catch(function (e) { _omEnsured = null; throw e; });
    return _omEnsured;
}

// ── settings ───────────────────────────────────────────────────
function omSeedFor(key) {
    return JSON.parse(JSON.stringify(key === 'BUS' ? OM_SEED_BUS : key === 'GENERAL' ? OM_SEED_GENERAL : key === 'SOURCES' ? OM_SEED_SOURCES : OM_SEED_LAYOUTS));
}
function omLoadSettings() {
    return omRead("SELECT setting_key, NVL(LENGTH(setting_value), 0) AS len FROM wms_om_settings", 50).then(function (rows) {
        var have = {}; rows.forEach(function (r) { have[r.SETTING_KEY] = +r.LEN; });
        return omSeq(['BUS', 'GENERAL', 'SOURCES', 'LAYOUTS'], function (k) {
            if (!have[k]) { OM.settings[k] = omSeedFor(k); return; }
            return omReadClob('wms_om_settings', 'setting_value', 'setting_key = ' + omLit(k)).then(function (txt) {
                var v = omJson(txt, null);
                if (k === 'GENERAL') v = Object.assign(omSeedFor('GENERAL'), v || {});
                if (k === 'SOURCES') { var s = omSeedFor('SOURCES'); Object.keys(v || {}).forEach(function (x) { s[x] = v[x]; }); v = s; }   // new starter sources appear after upgrades
                OM.settings[k] = v || omSeedFor(k);
            });
        });
    });
}
function omSaveSetting(key, value) {
    var txt = JSON.stringify(value), w = 'setting_key = ' + omLit(key);
    return omRead('SELECT COUNT(*) AS n FROM wms_om_settings WHERE ' + w, 1).then(function (r) {
        var ins = !(r[0] && +r[0].N);
        return (ins ? omWrite('INSERT INTO wms_om_settings (setting_key, setting_value, updated_by) VALUES (' + omLit(key) + ', EMPTY_CLOB(), ' + omV(OM.user, 120) + ')')
            : omWrite('UPDATE wms_om_settings SET updated_by = ' + omV(OM.user, 120) + ', updated_date = SYSDATE WHERE ' + w))
            .then(function () { return omWriteClob('wms_om_settings', 'setting_value', w, txt); });
    }).then(function () { OM.settings[key] = value; });
}
function omGen() { return OM.settings.GENERAL || OM_SEED_GENERAL; }
function omIsAdmin() {
    var a = omCsv(String(omGen().admins || '').split(/[,;]/)).map(function (x) { return x.toUpperCase(); });
    return !a.length || a.indexOf(OM.user) >= 0;
}
function omIsApprover() {
    var a = omCsv(String(omGen().approvers || '').split(/[,;]/)).map(function (x) { return x.toUpperCase(); });
    if (!a.length) return omIsAdmin();
    return a.indexOf(OM.user) >= 0;
}
function omBuByName(n) { return (OM.settings.BUS || []).filter(function (b) { return b.name === n; })[0] || null; }
function omBuId(bu) { bu = bu || OM.bu || {}; return OM.instance === 'TEST' && bu.buIdTest ? bu.buIdTest : bu.buId; }

// ── me (WMS_OM_USERS) ──────────────────────────────────────────
function omLoadMe() {
    return omRead('SELECT app_user, bu_name, warehouse, subinventory, salesrep_name, salesrep_id, price_list, order_prefix, next_no, NVL(LENGTH(prefs_json), 0) AS plen FROM wms_om_users WHERE app_user = ' + omLit(OM.user), 1).then(function (r) {
        if (r.length) { OM.me = r[0]; return; }
        var prefix = OM.user.replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'WEB';
        return omWrite('INSERT INTO wms_om_users (app_user, order_prefix, next_no, updated_by) VALUES (' + omLit(OM.user) + ', ' + omLit('W' + prefix) + ', 1, ' + omLit(OM.user) + ')').then(function () {
            OM.me = { APP_USER: OM.user, ORDER_PREFIX: 'W' + prefix, NEXT_NO: 1 };
        });
    });
}
function omSaveMe(fields) {
    var sets = Object.keys(fields).map(function (k) { return k + ' = ' + (k === 'next_no' ? omN(fields[k]) : omV(fields[k], 200)); });
    sets.push('updated_by = ' + omLit(OM.user), 'updated_date = SYSDATE');
    return omWrite('UPDATE wms_om_users SET ' + sets.join(', ') + ' WHERE app_user = ' + omLit(OM.user)).then(function () {
        Object.keys(fields).forEach(function (k) { OM.me[k.toUpperCase()] = fields[k]; });
    });
}
/** Next order number for this login: prefix + 6 digits, also never below an order number already in WMS_OM_ORDERS. */
function omNextOrderNo() {
    var prefix = OM.me.ORDER_PREFIX || 'WEB';
    return omWrite('UPDATE wms_om_users SET next_no = NVL(next_no, 1) + 1 WHERE app_user = ' + omLit(OM.user)).then(function () {
        return omRead('SELECT next_no FROM wms_om_users WHERE app_user = ' + omLit(OM.user), 1);
    }).then(function (r) {
        var n = (+(r[0] && r[0].NEXT_NO) || 2) - 1, no = prefix + ('000000' + n).slice(-6);
        return omRead('SELECT COUNT(*) AS c FROM wms_om_orders WHERE order_no = ' + omLit(no) + ' AND instance = ' + omLit(OM.instance), 1).then(function (x) {
            if (x[0] && +x[0].C) return omNextOrderNo();      // number taken (e.g. prefix shared) → take the next one
            OM.me.NEXT_NO = n + 1; return no;
        });
    });
}

// ── lookup sources ─────────────────────────────────────────────
function omSrc(key) { return (OM.settings.SOURCES || OM_SEED_SOURCES)[key]; }
function omVars(extra) {
    var bu = OM.bu || {};
    return Object.assign({ BU_ID: omBuId(bu) || '', BU_NAME: bu.name || '', ORG_ID: bu.orgId || '', ORG_CODE: bu.orgCode || '', WAREHOUSE: bu.warehouse || '',
        SUBINVENTORY: bu.subinventory || '', USER: OM.user, TODAY: today() }, extra || {});
}
function omFillText(t, vars, sqlQuote) {
    return String(t == null ? '' : t).replace(/\{\{(\w+)\}\}/g, function (_, k) {
        var v = vars[k]; if (v == null) return '';
        if (typeof v === 'object' && v.raw != null) return v.raw;          // pre-built lists: {raw: "'A','B'"}
        return sqlQuote ? String(v).replace(/'/g, "''") : String(v);
    });
}
/** Run a lookup source → array of row objects (UPPERCASE keys). */
function omRunSource(key, extraVars, opts) {
    var s = omSrc(key); opts = opts || {};
    if (!s) return Promise.reject('No source "' + key + '" in Setup.');
    var vars = omVars(extraVars);
    var job;
    if (s.kind === 'BIP') {
        var params = {};
        Object.keys(s.params || {}).forEach(function (p) { params[p] = omFillText(s.params[p], vars, false); });
        job = host('omBip', { path: s.path, params: params }).then(function (r) {
            if (!r || r.ok === false) throw (r && r.error) || 'Report failed';
            return r.rows || [];
        });
    } else if (s.kind === 'APEX') {
        job = omRead(omFillText(s.sql, vars, true), opts.max || 1000);
    } else {
        job = host('fusionSqlExecute', { sql: omFillText(s.sql, vars, true), rowLimit: opts.max || 20000 }).then(function (r) {
            if (!r || !r.success) throw (r && r.error) || 'Query failed';
            var cols = r.columns || [];
            return (r.rows || []).map(function (row) {
                if (!Array.isArray(row)) { var o = {}; Object.keys(row).forEach(function (k) { o[k.toUpperCase()] = row[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[String(c.name || c).toUpperCase()] = row[i]; }); return x;
            });
        });
    }
    return job.then(function (rows) {
        return rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; });
    });
}
function omMapped(key, row, field, names) {
    var s = omSrc(key), m = s && s.map && s.map[field];
    return omPick(row, m ? [m].concat(names) : names);
}
/** Cached lookup (per BU + vars); force = reload. */
function omLookup(key, extraVars, force) {
    var ck = key + '|' + (OM.bu ? OM.bu.name : '') + '|' + JSON.stringify(extraVars || {});
    if (!force && OM.lookups[ck]) return OM.lookups[ck];
    OM.lookups[ck] = omRunSource(key, extraVars).catch(function (e) { delete OM.lookups[ck]; throw e; });
    return OM.lookups[ck];
}

// normalisers for each lookup (column names differ per report — the source map wins)
function omNormCustomer(r) {
    var g = function (f, names) { return omMapped('customers', r, f, names); };
    return {
        number: omStr(g('number', ['CUSTOMER_NUMBER', 'ACCOUNT_NUMBER', 'CUST_NUMBER'])),
        name: omStr(g('name', ['CUSTOMER_NAME', 'PARTY_NAME', 'ACCOUNT_NAME', 'NAME'])),
        accountId: omStr(g('accountId', ['CUST_ACCOUNT_ID', 'ACCOUNT_ID', 'CUSTOMER_ACCOUNT_ID'])),
        partyId: omStr(g('partyId', ['PARTY_ID'])),
        partyNumber: omStr(g('partyNumber', ['PARTY_NUMBER'])),
        siteUseId: omStr(g('siteUseId', ['SITE_USE_ID', 'BILL_TO_SITE_USE_ID'])),
        partySiteId: omStr(g('partySiteId', ['PARTY_SITE_ID', 'SHIP_TO_PARTY_SITE_ID'])),
        creditLimit: omNum(g('creditLimit', ['CREDIT_LIMIT', 'OVERALL_CREDIT_LIMIT'])),
        terms: omStr(g('terms', ['PAYMENT_TERMS', 'TERMS', 'PAYMENT_TERM', 'STANDARD_TERMS'])),
        class: omStr(g('class', ['CUSTOMER_CLASS', 'CUSTOMER_CLASS_CODE', 'CLASS'])),
        category: omStr(g('category', ['CUSTOMER_CATEGORY', 'CUSTOMER_CAT', 'CATEGORY_CODE', 'CUSTOMER_CATEGORY_CODE'])),
        priceList: omStr(g('priceList', ['PRICE_LIST', 'PRICE_LIST_NAME'])),
        vat: omStr(g('vat', ['VAT', 'VAT_NUMBER', 'TAX_REGISTRATION_NUMBER', 'TAXPAYER_ID'])),
        brn: omStr(g('brn', ['BRN', 'BRN_NUMBER', 'BUSINESS_REGISTRATION'])),
        consignment: omStr(g('consignment', ['CONSIGNMENT', 'CONSIGNMENT_FLAG', 'CONS_FLAG'])),
        address: omStr(g('address', ['ADDRESS', 'ADDRESS1', 'BILL_TO_ADDRESS', 'SITE_ADDRESS']))
    };
}
function omNormOrderType(r) {
    var g = function (f, names) { return omMapped('orderTypes', r, f, names); };
    var o = { CODE: omStr(g('CODE', ['ORDER_TYPE_CODE', 'TRANSACTION_TYPE_CODE', 'LOOKUP_CODE', 'CODE'])), NAME: omStr(g('NAME', ['ORDER_TYPE', 'ORDER_TYPE_NAME', 'MEANING', 'NAME', 'DESCRIPTION'])) };
    ['TAX', 'DISCOUNTS', 'CREDITCHECK', 'LINETYPE', 'CHECKVIPSTOCK', 'BACKORDERSTATUS', 'STOCKSTATUS', 'REQUIRE_PO', 'REQUIRE_DO'].forEach(function (k) { o[k] = omStr(g(k, [k])); });
    if (!o.NAME) o.NAME = o.CODE; if (!o.CODE) o.CODE = o.NAME;
    var n = o.NAME.toUpperCase();
    if (!o.REQUIRE_DO && (/RETURN EMPT/.test(n) || /PAYMENT VOUCHER/.test(n))) { o.REQUIRE_DO = 'Y'; o.REQUIRE_PO = 'Y'; }   // legacy rule
    return o;
}
function omNamed(key, r, field, names) { return omStr(omMapped(key, r, field, names)); }

// ── orders (WMS_OM_ORDERS + timeline) ──────────────────────────
var OM_STATUS = {
    DRAFT: { label: 'Draft', cls: 'draft', icon: 'fa-pen' },
    PENDING_APPROVAL: { label: 'Waiting approval', cls: 'warn', icon: 'fa-hourglass-half' },
    APPROVED: { label: 'Approved', cls: 'ok', icon: 'fa-circle-check' },
    REJECTED: { label: 'Rejected', cls: 'err', icon: 'fa-circle-xmark' },
    FUSION_DRAFT: { label: 'Fusion draft', cls: 'info', icon: 'fa-cloud' },
    SUBMITTED: { label: 'In Fusion', cls: 'done', icon: 'fa-cloud-arrow-up' },
    FAILED: { label: 'Failed', cls: 'err', icon: 'fa-triangle-exclamation' },
    DISCARDED: { label: 'Discarded', cls: 'muted', icon: 'fa-trash' }
};
function omStatusChip(st) { var s = OM_STATUS[st] || { label: st || '—', cls: 'draft', icon: 'fa-circle' }; return '<span class="chip ' + s.cls + '"><i class="fa-solid ' + s.icon + '"></i> ' + esc(s.label) + '</span>'; }

/** Strip what does not need storing (caches, explanations are rebuilt). */
function omLinesForSave(lines) {
    return (lines || []).filter(function (l) { return l.item; }).map(function (l) {
        var o = {}; Object.keys(l).forEach(function (k) { if (k !== 'discWhy' && k !== '__idx' && l[k] !== '' && l[k] != null) o[k] = l[k]; }); return o;
    });
}
function omSaveOrder(order, status) {
    var h = order.header, g = omGen();
    var ctx = { precision: g.precision, taxRates: g.taxRates, taxOff: omUp((order.orderTypeAttrs || {}).TAX) === 'NO' };
    var t = omTotals(order.lines, ctx);
    var st = status || order.status || 'DRAFT';
    var cols = {
        bu_name: omV(h.bu, 120), status: omV(st, 30), verdict: omV(order.verdict, 20), customer_number: omV(h.customerNumber, 60), customer_name: omV(h.customerName, 360),
        order_type: omV(h.orderType, 120), customer_po: omV(h.customerPo, 120), order_date: omD(h.orderDate), currency: omV(h.currency, 10),
        total_net: omN(t.net), total_tax: omN(t.tax), total_disc: omN(t.disc), line_count: omN(t.lines)
    };
    var hdr = Object.assign({}, h, { orderTypeAttrs: order.orderTypeAttrs || null });
    var job;
    if (order.id) {
        job = omWrite('UPDATE wms_om_orders SET ' + Object.keys(cols).map(function (k) { return k + ' = ' + cols[k]; }).join(', ') +
            ', updated_by = ' + omLit(OM.user) + ', updated_date = SYSDATE WHERE order_id = ' + omN(order.id));
    } else {
        job = omWrite('INSERT INTO wms_om_orders (order_no, instance, created_by, updated_by, ' + Object.keys(cols).join(', ') + ') VALUES (' +
            omLit(h.orderNo) + ', ' + omLit(OM.instance) + ', ' + omLit(OM.user) + ', ' + omLit(OM.user) + ', ' + Object.keys(cols).map(function (k) { return cols[k]; }).join(', ') + ')')
            .then(function () { return omRead('SELECT order_id FROM wms_om_orders WHERE order_no = ' + omLit(h.orderNo) + ' AND instance = ' + omLit(OM.instance), 1); })
            .then(function (r) { order.id = +r[0].ORDER_ID; return omEvent(order.id, 'CREATED', 'Order ' + h.orderNo + ' created'); });
    }
    return job.then(function () {
        var w = 'order_id = ' + omN(order.id);
        return omWriteClob('wms_om_orders', 'header_json', w, JSON.stringify(hdr)).then(function () {
            return omWriteClob('wms_om_orders', 'lines_json', w, JSON.stringify(omLinesForSave(order.lines)));
        });
    }).then(function () { order.status = st; order.savedAt = Date.now(); return order; });
}
function omSetStatus(orderId, status, extra) {
    var sets = ['status = ' + omV(status, 30), 'updated_by = ' + omLit(OM.user), 'updated_date = SYSDATE'];
    Object.keys(extra || {}).forEach(function (k) { sets.push(k + ' = ' + (extra[k] === 'SYSDATE' ? 'SYSDATE' : omV(extra[k], 4000))); });
    return omWrite('UPDATE wms_om_orders SET ' + sets.join(', ') + ' WHERE order_id = ' + omN(orderId));
}
function omLoadOrder(id) {
    var w = 'order_id = ' + omN(id);
    return omRead("SELECT order_id, order_no, status, verdict, fusion_header_id, fusion_order_no, fusion_status, last_error, created_by, TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI') AS created FROM wms_om_orders WHERE " + w, 1).then(function (r) {
        if (!r.length) throw 'Order ' + id + ' not found.';
        var o = { id: +r[0].ORDER_ID, status: r[0].STATUS, verdict: r[0].VERDICT, createdBy: r[0].CREATED_BY, created: r[0].CREATED,
            fusion: { headerId: r[0].FUSION_HEADER_ID, orderNo: r[0].FUSION_ORDER_NO, status: r[0].FUSION_STATUS }, lastError: r[0].LAST_ERROR };
        return omReadClob('wms_om_orders', 'header_json', w).then(function (hj) {
            o.header = omJson(hj, {}); o.orderTypeAttrs = o.header.orderTypeAttrs || {}; delete o.header.orderTypeAttrs;
            o.header.orderNo = o.header.orderNo || r[0].ORDER_NO;
            return omReadClob('wms_om_orders', 'lines_json', w);
        }).then(function (lj) { o.lines = omJson(lj, []); return o; });
    });
}
function omEvent(orderId, type, detail, data) {
    if (!orderId) return Promise.resolve();
    return omWrite('INSERT INTO wms_om_events (order_id, event_type, detail, data_json, created_by) VALUES (' + omN(orderId) + ', ' + omV(type, 40) + ', ' +
        omV(detail, 3900) + ', ' + (data ? omClob(JSON.stringify(data).slice(0, 30000)) : 'NULL') + ', ' + omLit(OM.user) + ')').catch(function (e) { console.warn('[OM] event', e); });
}
function omEvents(orderId) {
    return omRead("SELECT event_id, event_type, detail, created_by, TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI:SS') AS at, NVL(LENGTH(data_json), 0) AS dlen FROM wms_om_events WHERE order_id = " +
        omN(orderId) + ' ORDER BY event_id DESC', 200);
}

// ── discount rules ─────────────────────────────────────────────
function omLoadRules(force) {
    if (OM.rules && !force) return Promise.resolve(OM.rules);
    var all = [];
    function page(from) {
        return omRead("SELECT * FROM (SELECT q.*, ROWNUM AS rn FROM (SELECT rule_id, ctx, disc_level AS \"LEVEL\", target, pct, TO_CHAR(valid_from, 'YYYY-MM-DD') AS \"FROM\", " +
            "TO_CHAR(valid_to, 'YYYY-MM-DD') AS \"TO\", excl, disc_ref, cust_no, cust_cat, min_qty, max_qty, active, source FROM wms_om_discounts ORDER BY rule_id) q) WHERE rn BETWEEN " + from + ' AND ' + (from + 999), 1000)
            .then(function (r) { all = all.concat(r); if (r.length === 1000) return page(from + 1000); });
    }
    return page(1).then(function () {
        OM.rulesRaw = all;
        OM.rules = all.map(function (r) { var n = omNormRule(r); n.source = r.SOURCE; return n; });
        return OM.rules;
    });
}

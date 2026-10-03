/* Finance Lens — the discovered Oracle Fusion chart of accounts kept in APEX (shared by every PC) through the app's
   ai/executequery | executewrite gateway (host action executePost):
     WMS_FIN_DISCOVERY     one row per pod: the whole discovery (JSON, CLOB) so the Data tab restores it without asking Fusion again
     WMS_FIN_COA_SEGMENTS  one row per pod × chart × segment: name, qualifiers, values, purity, role (COMPANY / COST_CENTRE /
                           ACCOUNT / INTERCOMPANY — the roles you chose win), why
     WMS_FIN_LEDGERS       one row per pod × ledger: currency, chart, calendar, balancing column, companies, selected for loading
   Created by the page on first use (apex_sql/85_finance_lens_fusion.sql). The same discovery is also written to the finance
   DuckDB file by the host (fin_fusion_discovery / fin_coa_segments) — the page reads APEX first, then DuckDB.
   APEX reads never contain DBMS_ / UTL_ or the words the gateway refuses; CLOBs are read in 4,000-character pieces. */
(function () {
    var A = FL.apexStore = {};
    A.URL = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
    var lit = function (s) { return s == null || s === '' ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'"; };
    var num = function (v) { var n = +v; return isFinite(n) ? String(n) : 'NULL'; };
    var cut = function (s, n) { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) : s; };

    A.call = function (op, payload) {
        return FL.host('executePost', { fullUrl: A.URL + '/' + op, body: JSON.stringify(Object.assign({ appUser: appUser() || (FL.who || {}).user || 'WMS' }, payload)) }, 120000).then(function (d) {
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { throw new Error('Unexpected database reply: ' + d.slice(0, 150)); } }
            if (!d || d.success === false) throw new Error((d && (d.error || d.message)) || 'Database API error');
            return d;
        });
    };
    A.read = function (sql, max) {
        return A.call('executequery', { sql: sql, maxRows: max || 500 }).then(function (d) {
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                var o = {};
                if (Array.isArray(r)) cols.forEach(function (c, i) { o[c] = r[i]; }); else Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; });
                return o;
            });
        });
    };
    A.write = function (sql) { return A.call('executewrite', { sql: sql }); };

    var TABLES = {
        WMS_FIN_DISCOVERY: 'CREATE TABLE wms_fin_discovery (pod VARCHAR2(20) NOT NULL, discovered_at DATE DEFAULT SYSDATE, discovered_by VARCHAR2(100), ledgers NUMBER, charts NUMBER, ' +
            'disc_json CLOB, CONSTRAINT wms_fin_discovery_pk PRIMARY KEY (pod))',
        WMS_FIN_COA_SEGMENTS: 'CREATE TABLE wms_fin_coa_segments (pod VARCHAR2(20) NOT NULL, coa_id VARCHAR2(30) NOT NULL, column_name VARCHAR2(30) NOT NULL, segment_name VARCHAR2(200), ' +
            'segment_num NUMBER, value_set_id VARCHAR2(40), qualifiers VARCHAR2(400), distinct_values NUMBER, purity NUMBER, role VARCHAR2(30), evidence VARCHAR2(1000), ' +
            'discovered_at DATE DEFAULT SYSDATE, discovered_by VARCHAR2(100), CONSTRAINT wms_fin_coa_segments_pk PRIMARY KEY (pod, coa_id, column_name))',
        WMS_FIN_LEDGERS: 'CREATE TABLE wms_fin_ledgers (pod VARCHAR2(20) NOT NULL, ledger_id NUMBER NOT NULL, ledger_name VARCHAR2(200), short_name VARCHAR2(100), currency VARCHAR2(15), ' +
            'coa_id VARCHAR2(30), period_set VARCHAR2(100), period_type VARCHAR2(60), category VARCHAR2(60), bal_seg_column VARCHAR2(30), companies VARCHAR2(4000), ' +
            'selected CHAR(1) DEFAULT \'N\', discovered_at DATE DEFAULT SYSDATE, discovered_by VARCHAR2(100), CONSTRAINT wms_fin_ledgers_pk PRIMARY KEY (pod, ledger_id))'
    };
    var ready = null;
    A.ensure = function () {
        if (ready) return ready;
        ready = A.read("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_FIN_DISCOVERY', 'WMS_FIN_COA_SEGMENTS', 'WMS_FIN_LEDGERS')").then(function (rows) {
            var have = {}; rows.forEach(function (r) { have[r.TABLE_NAME] = 1; });
            return Object.keys(TABLES).filter(function (t) { return !have[t]; }).reduce(function (p, t) { return p.then(function () { return A.write(TABLES[t]); }); }, Promise.resolve());
        }).catch(function (e) { ready = null; throw e; });
        return ready;
    };
    var podKey = function (pod) { return pod || 'LOGGED-IN'; };

    /** Rows of WMS_FIN_COA_SEGMENTS for a discovery; roles = {coaId: {company, costCentre, account}} (chosen) or null (as found). */
    A.segmentRows = function (d, roles) {
        var out = [], NAME = { company: 'COMPANY', costCentre: 'COST_CENTRE', account: 'ACCOUNT', intercompany: 'INTERCOMPANY' };
        Object.keys(d.coas || {}).forEach(function (id) {
            var c = d.coas[id], found = { company: c.company, costCentre: c.costCentre, account: c.account, intercompany: c.intercompany }, chosen = roles && roles[id];
            if (chosen) ['company', 'costCentre', 'account'].forEach(function (k) { found[k] = chosen[k] || null; });
            (c.segments || []).forEach(function (s) {
                var role = Object.keys(found).filter(function (k) { return found[k] === s.col; })[0];
                var why = role ? ((chosen && chosen[role] && chosen[role] !== c[role]) ? 'Chosen by the user' : (c.why || {})[role] || '') : '';
                out.push({ coa: id, col: s.col, name: s.name, num: s.num, vs: s.valueSetId, q: (s.qualifiers || []).join(','), distinct: s.distinct || 0, purity: s.purity || 0, role: role ? NAME[role] : null, why: why });
            });
        });
        return out;
    };

    /** Saves a discovery (and, after a load, the chosen roles and ledgers) — replaces what the pod had. */
    A.saveDiscovery = function (d, roles, selectedIds) {
        var pod = podKey(d.pod), by = (FL.who || {}).user || appUser() || 'WMS', json = JSON.stringify(slim(d)), sel = {};
        (selectedIds || []).forEach(function (i) { sel[String(i)] = 1; });
        var segs = A.segmentRows(d, roles), leds = d.ledgers || [];
        var step = function (p, sql) { return p.then(function () { return A.write(sql); }); };
        return A.ensure().then(function () {
            var p = Promise.resolve();
            // the whole discovery: first piece in the MERGE, the rest appended 20,000 characters at a time (statement size)
            var pieces = []; for (var i = 0; i < json.length; i += 20000) pieces.push(json.slice(i, i + 20000));
            var clob = function (s) { var parts = []; for (var j = 0; j < s.length; j += 1000) parts.push('TO_CLOB(' + lit(s.slice(j, j + 1000)) + ')'); return parts.join(' || ') || 'EMPTY_CLOB()'; };
            p = step(p, 'MERGE INTO wms_fin_discovery t USING (SELECT ' + lit(pod) + ' pod FROM dual) s ON (t.pod = s.pod) ' +
                'WHEN MATCHED THEN UPDATE SET discovered_at = SYSDATE, discovered_by = ' + lit(by) + ', ledgers = ' + leds.length + ', charts = ' + Object.keys(d.coas || {}).length + ', disc_json = ' + clob(pieces[0] || '') + ' ' +
                'WHEN NOT MATCHED THEN INSERT (pod, discovered_at, discovered_by, ledgers, charts, disc_json) VALUES (' + lit(pod) + ', SYSDATE, ' + lit(by) + ', ' + leds.length + ', ' + Object.keys(d.coas || {}).length + ', ' + clob(pieces[0] || '') + ')');
            pieces.slice(1).forEach(function (pc) { p = step(p, 'UPDATE wms_fin_discovery SET disc_json = disc_json || ' + clob(pc) + ' WHERE pod = ' + lit(pod)); });
            p = step(p, 'DELETE FROM wms_fin_coa_segments WHERE pod = ' + lit(pod));
            for (var k = 0; k < segs.length; k += 40) {
                var chunk = segs.slice(k, k + 40);
                p = step(p, 'INSERT INTO wms_fin_coa_segments (pod, coa_id, column_name, segment_name, segment_num, value_set_id, qualifiers, distinct_values, purity, role, evidence, discovered_at, discovered_by) ' +
                    chunk.map(function (s) {
                        return 'SELECT ' + [lit(pod), lit(s.coa), lit(s.col), lit(cut(s.name, 200)), num(s.num), lit(cut(s.vs, 40)), lit(cut(s.q, 400)), num(s.distinct), num(s.purity), lit(s.role), lit(cut(s.why, 1000)), 'SYSDATE', lit(by)].join(', ') + ' FROM dual';
                    }).join(' UNION ALL '));
            }
            p = step(p, 'DELETE FROM wms_fin_ledgers WHERE pod = ' + lit(pod));
            for (var m = 0; m < leds.length; m += 25) {
                var lc = leds.slice(m, m + 25);
                p = step(p, 'INSERT INTO wms_fin_ledgers (pod, ledger_id, ledger_name, short_name, currency, coa_id, period_set, period_type, category, bal_seg_column, companies, selected, discovered_at, discovered_by) ' +
                    lc.map(function (l) {
                        var cos = (l.companies || []).map(function (c) { return c.value + (c.legalEntity ? ' ' + c.legalEntity : ''); }).join('; ');
                        return 'SELECT ' + [lit(pod), num(l.id), lit(cut(l.name, 200)), lit(cut(l.shortName, 100)), lit(l.currency), lit(l.coaId), lit(cut(l.periodSet, 100)), lit(cut(l.periodType, 60)), lit(l.category), lit(l.balSegCol),
                            lit(cut(cos, 4000)), lit(sel[String(l.id)] ? 'Y' : 'N'), 'SYSDATE', lit(by)].join(', ') + ' FROM dual';
                    }).join(' UNION ALL '));
            }
            return p;
        });
    };
    /** What is kept of a discovery: the open periods only (the full status list of every ledger can be long) */
    function slim(d) {
        var c = JSON.parse(JSON.stringify(d));
        (c.ledgers || []).forEach(function (l) { var o = {}; Object.keys(l.periodStatus || {}).forEach(function (k) { if (l.periodStatus[k] === 'O') o[k] = 'O'; }); l.periodStatus = o; });
        return c;
    }

    /** The saved discovery of a pod: {disc, at, by, where: 'APEX' | 'DuckDB'} or null — APEX first (shared), then this PC's DuckDB file. */
    A.loadDiscovery = function (pod) {
        var key = podKey(pod);
        var fromApex = A.ensure().then(function () {
            return A.read('SELECT TO_CHAR(discovered_at, \'YYYY-MM-DD HH24:MI\') disc_at, discovered_by, LENGTH(disc_json) json_len FROM wms_fin_discovery WHERE pod = ' + lit(key), 1);
        }).then(function (r) {
            if (!r.length || !r[0].JSON_LEN) return null;
            var len = +r[0].JSON_LEN, cols = [];
            for (var i = 1; i <= len; i += 4000) cols.push('TO_CHAR(SUBSTR(disc_json, ' + i + ', 4000)) p' + cols.length);
            var groups = []; for (var g = 0; g < cols.length; g += 20) groups.push(cols.slice(g, g + 20));
            return Promise.all(groups.map(function (gr) { return A.read('SELECT ' + gr.join(', ') + ' FROM wms_fin_discovery WHERE pod = ' + lit(key), 1); })).then(function (parts) {
                var s = '';
                parts.forEach(function (rows, gi) { groups[gi].forEach(function (_, j) { s += (rows[0] || {})['P' + (gi * 20 + j)] || ''; }); });
                var d = JSON.parse(s); d.pod = pod || '';
                return { disc: d, at: r[0].DISC_AT, by: r[0].DISCOVERED_BY, where: 'APEX' };
            });
        });
        return fromApex.catch(function (e) { console.warn('[Finance] APEX discovery not read:', e); return null; }).then(function (res) {
            if (res) return res;
            return FL.call('finDiscoveryGet', { pod: pod || '' }).then(function (r) {
                if (!r.found) return null;
                var d = JSON.parse(r.json); d.pod = pod || '';
                return { disc: d, at: String(r.at || '').replace('T', ' ').slice(0, 16), by: r.by, where: 'DuckDB' };
            }).catch(function () { return null; });
        });
    };
})();

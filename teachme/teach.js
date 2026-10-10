/* Teach Me — teachme/index.html. People teach the app subjects:
     notes       a subject explained in their own words (Markdown)
     navigation  a task on a website, shown once in the Teach Me browser window and recorded as steps (click / type / pick),
                 with variables ({{name}}) for the parts that change; Run repeats it with new values, stops before the
                 step marked "stop" (the Submit button — never pressed by the app) and reads the result from the page
                 (capture rule, e.g. the Oracle SR number).
   Every lesson is one JSON document saved in APEX (WMS_TEACH_LESSONS, created here) and in this PC's DuckDB file
   (host teachSave → C:\fusion\teachme\teachme.duckdb); on open both are read and the newer copy (version) wins and is
   written back to the other side. Runs: WMS_TEACH_RUNS + DuckDB teach_runs. Host: classes/Form1_TeachHandlers.cs. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var lsGet = function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
    var lsSet = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    var APEX = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
    var TM = window.TM = { lessons: [], cur: null, tab: 'lesson', recording: false, recFor: null, lastUrl: '', run: null, dirty: false, store: { pc: null, apex: null } };
    TM.user = (function () { try { return (sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || localStorage.getItem('username') || 'UNKNOWN').toUpperCase(); } catch (e) { return 'UNKNOWN'; } })();
    var now = function () { var d = new Date(), p = function (x) { return ('0' + x).slice(-2); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
    var newId = function (p) { return (p || 'L') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

    // ── host bridge ─────────────────────────────────────────────
    var pending = {};
    TM.hasHost = function () { return !!(window.chrome && window.chrome.webview); };
    TM.host = function (action, payload) {
        return new Promise(function (resolve, reject) {
            if (!TM.hasHost()) { reject('Open this page inside the Gray\'s WMS app.'); return; }
            var id = 'tm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            pending[id] = { resolve: resolve, reject: reject };
            window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: TM.user }, payload || {}));
        });
    };
    if (TM.hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r) return;
        if (r.action === 'teachEvent') { TM.onEvent(r.data || {}); return; }
        if (!r.requestId || !pending[r.requestId]) return;
        var cb = pending[r.requestId]; delete pending[r.requestId];
        if (r.action === 'error') cb.reject(r.message || 'Host error'); else cb.resolve(r.data == null ? r : r.data);
    });
    var hostOk = function (action, payload) { return TM.host(action, payload).then(function (d) { if (d && d.ok === false) throw d.error || 'Failed'; return d; }); };

    // ── APEX ────────────────────────────────────────────────────
    var A = TM.apex = {};
    A.call = function (path, payload) {
        return TM.host('executePost', { fullUrl: APEX + path, body: JSON.stringify(Object.assign({ appUser: TM.user }, payload)) }).then(function (d) {
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { throw 'Unexpected answer from the database API'; } }
            if (!d || d.success === false) throw (d && d.error) || 'Database API error';
            return d;
        });
    };
    A.rows = function (sql, max) {
        return A.call('/executequery', { sql: sql, maxRows: Math.min(max || 500, 1000) }).then(function (d) {
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
            });
        });
    };
    A.write = function (sql) { return A.call('/executewrite', { sql: sql }); };
    A.lit = function (s, max) { if (s == null || s === '') return 'NULL'; s = String(s); if (max) s = s.slice(0, max); return "'" + s.replace(/'/g, "''") + "'"; };
    /** CLOB literal: pieces of 1,000 characters (a SQL text literal holds at most 4,000 bytes). */
    A.clob = function (s) {
        if (s == null || s === '') return 'NULL';
        var parts = []; for (var i = 0; i < s.length; i += 1000) parts.push("TO_CLOB('" + s.slice(i, i + 1000).replace(/'/g, "''") + "')");
        return parts.join(' || ');
    };
    A.ready = null;
    A.ensure = function () {
        if (A.ready) return A.ready;
        A.ready = A.rows("SELECT table_name AS T FROM user_tables WHERE table_name IN ('WMS_TEACH_LESSONS', 'WMS_TEACH_RUNS')").then(function (r) {
            var have = r.map(function (x) { return x.T; }), p = Promise.resolve();
            if (have.indexOf('WMS_TEACH_LESSONS') < 0) p = p.then(function () {
                return A.write('CREATE TABLE wms_teach_lessons (id VARCHAR2(60) PRIMARY KEY, subject VARCHAR2(200), title VARCHAR2(400), kind VARCHAR2(20), version NUMBER DEFAULT 1, ' +
                    "doc_json CLOB, removed VARCHAR2(1) DEFAULT 'N', created_by VARCHAR2(100), created_date DATE DEFAULT SYSDATE, changed_by VARCHAR2(100), changed_date DATE)");
            });
            if (have.indexOf('WMS_TEACH_RUNS') < 0) p = p.then(function () {
                return A.write('CREATE TABLE wms_teach_runs (id VARCHAR2(60) PRIMARY KEY, lesson_id VARCHAR2(60), lesson_title VARCHAR2(400), lesson_version NUMBER, run_by VARCHAR2(100), ' +
                    'started_date DATE, finished_date DATE, status VARCHAR2(30), result VARCHAR2(400), values_json CLOB, log_json CLOB)');
            });
            return p;
        }).catch(function (e) { A.ready = null; throw e; });
        return A.ready;
    };
    /** Reads a CLOB column of many rows in pieces (TO_CHAR(SUBSTR()) — the gateway allows no DBMS_ calls). */
    A.readClob = function (table, col, ids, piece) {
        piece = piece || 3900;
        var out = {};
        if (!ids.length) return Promise.resolve(out);
        var where = ' WHERE id IN (' + ids.map(function (i) { return A.lit(i); }).join(', ') + ')';
        return A.rows('SELECT id AS ID, NVL(LENGTH(' + col + '), 0) AS L FROM ' + table + where, 1000).then(function (lens) {
            var max = 0; lens.forEach(function (x) { out[x.ID] = ''; max = Math.max(max, +x.L || 0); });
            var starts = []; for (var p = 1; p <= max; p += piece) starts.push(p);
            return starts.reduce(function (pr, p) {
                return pr.then(function () {
                    return A.rows('SELECT id AS ID, TO_CHAR(SUBSTR(' + col + ', ' + p + ', ' + piece + ')) AS P FROM ' + table + where + ' AND LENGTH(' + col + ') >= ' + p, 1000).then(function (r) {
                        r.forEach(function (x) { out[x.ID] = (out[x.ID] || '') + (x.P || ''); });
                    });
                });
            }, Promise.resolve()).then(function () { return out; });
        }).catch(function (e) { if (piece > 1000) return A.readClob(table, col, ids, 1000); throw e; });
    };
    A.lessons = function () {
        return A.ensure().then(function () {
            return A.rows("SELECT id AS ID, version AS V, removed AS R, changed_by AS CB, TO_CHAR(NVL(changed_date, created_date), 'YYYY-MM-DD HH24:MI:SS') AS AT FROM wms_teach_lessons", 1000);
        }).then(function (meta) {
            return A.readClob('wms_teach_lessons', 'doc_json', meta.map(function (m) { return m.ID; })).then(function (docs) {
                return meta.map(function (m) {
                    var doc = null; try { doc = JSON.parse(docs[m.ID] || 'null'); } catch (e) { }
                    return doc ? { doc: doc, version: +m.V || 0, removed: m.R === 'Y' } : null;
                }).filter(Boolean);
            });
        });
    };
    A.save = function (l) {
        var id = A.lit(l.id), json = JSON.stringify(l);
        return A.ensure().then(function () {
            return A.write('MERGE INTO wms_teach_lessons t USING (SELECT ' + id + ' AS id FROM dual) s ON (t.id = s.id) ' +
                'WHEN MATCHED THEN UPDATE SET subject = ' + A.lit(l.subject, 200) + ', title = ' + A.lit(l.title, 400) + ', kind = ' + A.lit(l.kind, 20) + ', version = ' + (+l.version || 1) +
                ', removed = ' + A.lit(l.removed === 'Y' ? 'Y' : 'N') + ', changed_by = ' + A.lit(TM.user, 100) + ', changed_date = SYSDATE ' +
                'WHEN NOT MATCHED THEN INSERT (id, subject, title, kind, version, removed, created_by, created_date, changed_by, changed_date) VALUES (' +
                id + ', ' + A.lit(l.subject, 200) + ', ' + A.lit(l.title, 400) + ', ' + A.lit(l.kind, 20) + ', ' + (+l.version || 1) + ', ' + A.lit(l.removed === 'Y' ? 'Y' : 'N') + ', ' +
                A.lit(l.createdBy || TM.user, 100) + ', SYSDATE, ' + A.lit(TM.user, 100) + ', SYSDATE)');
        }).then(function () { return A.write('UPDATE wms_teach_lessons SET doc_json = ' + A.clob(json) + ' WHERE id = ' + id); });
    };
    A.saveRun = function (r) {
        return A.ensure().then(function () {
            var d = function (s) { return s ? "TO_DATE(" + A.lit(String(s).slice(0, 19).replace('T', ' ')) + ", 'YYYY-MM-DD HH24:MI:SS')" : 'NULL'; };
            return A.write('INSERT INTO wms_teach_runs (id, lesson_id, lesson_title, lesson_version, run_by, started_date, finished_date, status, result, values_json, log_json) VALUES (' +
                [A.lit(r.id), A.lit(r.lessonId), A.lit(r.lessonTitle, 400), +r.lessonVersion || 0, A.lit(r.runBy, 100), d(r.startedAt), d(r.finishedAt), A.lit(r.status, 30), A.lit(r.result, 400),
                 A.clob(r.values), A.clob(r.log)].join(', ') + ')');
        });
    };
    A.runs = function (lessonId) {
        return A.ensure().then(function () {
            return A.rows("SELECT id AS ID, run_by AS RUN_BY, TO_CHAR(started_date, 'YYYY-MM-DD HH24:MI:SS') AS STARTED_AT, status AS STATUS, result AS RESULT FROM wms_teach_runs WHERE lesson_id = " +
                A.lit(lessonId) + ' ORDER BY started_date DESC', 200);
        });
    };

    // ── UI helpers ──────────────────────────────────────────────
    TM.toast = function (t, kind) { var el = $('toast'); el.textContent = t; el.className = 'toast ' + (kind || ''); el.style.display = 'block'; clearTimeout(TM.toast.t); TM.toast.t = setTimeout(function () { el.style.display = 'none'; }, kind === 'err' ? 8000 : 3500); };
    TM.modal = function (title, body, buttons) {
        return new Promise(function (resolve) {
            $('modal-box').innerHTML = '<h3>' + title + '</h3><div>' + body + '</div><div class="foot">' + (buttons || [['Cancel', ''], ['OK', 'ok', 'primary']]).map(function (b) { return '<button class="btn ' + (b[2] || '') + '" data-b="' + b[1] + '">' + b[0] + '</button>'; }).join('') + '</div>';
            $('modal').hidden = false;
            $('modal-box').querySelectorAll('[data-b]').forEach(function (b) { b.onclick = function () { var v = b.dataset.b; var box = $('modal-box'); $('modal').hidden = true; resolve({ button: v, box: box }); }; });
            var f = $('modal-box').querySelector('input,textarea,select'); if (f) f.focus();
        });
    };
    TM.md = function (s) {
        var out = [], list = null;
        String(s || '').split(/\r?\n/).forEach(function (line) {
            var inl = function (t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*(.+?)\*/g, '<i>$1</i>'); };
            var m;
            if ((m = /^\s*(\d+)\.\s+(.*)$/.exec(line))) { if (list !== 'ol') { if (list) out.push('</' + list + '>'); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inl(m[2]) + '</li>'); return; }
            if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { if (list !== 'ul') { if (list) out.push('</' + list + '>'); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inl(m[1]) + '</li>'); return; }
            if (list) { out.push('</' + list + '>'); list = null; }
            if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) out.push('<h' + m[1].length + '>' + inl(m[2]) + '</h' + m[1].length + '>');
            else if (line.trim()) out.push('<p>' + inl(line) + '</p>');
        });
        if (list) out.push('</' + list + '>');
        return out.join('');
    };

    // ── lessons: load, merge, save ──────────────────────────────
    TM.load = function () {
        var pc = TM.host('teachList').then(function (d) { TM.store.pc = { ok: true, n: (d.lessons || []).length, path: d.path }; return d.lessons || []; },
            function (e) { TM.store.pc = { ok: false, error: String(e) }; return []; });
        var ap = A.lessons().then(function (l) { TM.store.apex = { ok: true, n: l.length }; return l; },
            function (e) { TM.store.apex = { ok: false, error: String(e) }; return []; });
        return Promise.all([pc, ap]).then(function (r) {
            var by = {}, pcBy = {}, apBy = {};
            r[0].forEach(function (x) { pcBy[x.doc.id] = x; });
            r[1].forEach(function (x) { apBy[x.doc.id] = x; });
            Object.keys(pcBy).concat(Object.keys(apBy)).forEach(function (id) {
                var p = pcBy[id], a = apBy[id], best = !p ? a : !a ? p : (+a.version >= +p.version ? a : p);
                best.doc.version = best.version || best.doc.version || 0;
                if (best.removed) best.doc.removed = 'Y';
                by[id] = best.doc;
                // keep both copies the same: write the newer one where it is missing or older
                if (TM.store.pc && TM.store.pc.ok && (!p || +p.version < +best.version)) TM.host('teachSave', { lesson: best.doc }).catch(function () { });
                if (TM.store.apex && TM.store.apex.ok && (!a || +a.version < +best.version)) A.save(best.doc).catch(function () { });
            });
            TM.lessons = Object.keys(by).map(function (k) { return by[k]; });
            TM.paintStore(); TM.paintTree();
            var want = lsGet('teachme.cur', null), l = TM.lessons.filter(function (x) { return x.id === want && x.removed !== 'Y'; })[0];
            if (l && !TM.cur) TM.open(l.id); else if (!TM.cur) TM.paintMain();
        });
    };
    TM.paintStore = function () {
        var s = TM.store, chip = function (label, x) { return '<span title="' + esc(x ? (x.ok ? (x.path || '') : x.error) : 'reading…') + '">' + (x ? (x.ok ? '✓ ' : '✗ ') : '… ') + label + (x && x.ok ? ' · ' + x.n : '') + '</span>'; };
        $('store').innerHTML = chip('This PC (DuckDB)', s.pc) + chip('APEX', s.apex);
    };
    TM.save = function (quiet) {
        var l = TM.cur; if (!l) return Promise.resolve();
        l.title = (l.title || '').trim() || 'Untitled lesson';
        l.subject = (l.subject || '').trim() || 'General';
        l.version = (+l.version || 0) + 1;
        l.changedBy = TM.user; l.changedAt = now();
        if (!l.createdBy) { l.createdBy = TM.user; l.createdAt = l.changedAt; }
        var res = { pc: null, apex: null };
        var p1 = hostOk('teachSave', { lesson: l }).then(function () { res.pc = true; }, function (e) { res.pc = String(e); });
        var p2 = A.save(l).then(function () { res.apex = true; }, function (e) { res.apex = String(e); });
        return Promise.all([p1, p2]).then(function () {
            TM.dirty = false;
            if (TM.lessons.indexOf(l) < 0) TM.lessons.push(l);
            var live = TM.lessons.filter(function (x) { return x.removed !== 'Y' && x.version; }).length;
            if (res.pc === true) TM.store.pc = Object.assign({}, TM.store.pc, { ok: true, n: live });
            if (res.apex === true) TM.store.apex = Object.assign({}, TM.store.apex, { ok: true, n: live });
            TM.paintStore(); TM.paintTree(); TM.paintHead();
            var bad = [res.pc !== true ? 'this PC: ' + res.pc : null, res.apex !== true ? 'APEX: ' + res.apex : null].filter(Boolean);
            if (bad.length) TM.toast('Saved with problems — ' + bad.join(' · '), 'err');
            else if (!quiet) TM.toast('Saved in APEX and on this PC (version ' + l.version + ').', 'ok');
        });
    };
    TM.touch = function () { TM.dirty = true; TM.paintHead(); };

    // ── templates ───────────────────────────────────────────────
    TM.blank = function (kind) {
        return { id: newId('L'), subject: TM.subject || '', title: kind === 'notes' ? 'New notes' : 'New navigation lesson', kind: kind, tags: '', notes: '',
                 startUrl: '', steps: [], vars: [], capture: { regex: '', label: '' }, version: 0 };
    };
    TM.ORACLE_SR = function () {
        var l = TM.blank('navigation');
        l.subject = 'Oracle Support'; l.title = 'Raise a Service Request (SR) on My Oracle Support';
        l.startUrl = 'https://support.oracle.com/portal/';
        l.tags = 'oracle, support, SR';
        l.capture = { regex: '\\b(3-\\d{8,12})\\b', label: 'SR number' };
        l.vars = [
            { name: 'summary', label: 'Problem summary', hint: 'One line, under 100 characters: what is wrong and where', ai: true },
            { name: 'description', label: 'Detailed description', hint: 'What happened, when, what was expected, what was tried', ai: true, long: true },
            { name: 'error', label: 'Error message', hint: 'Exact text of the error, codes kept as they are', ai: true, long: true },
            { name: 'steps', label: 'Steps to reproduce', hint: 'Numbered steps', ai: true, long: true },
            { name: 'product', label: 'Product / service', hint: 'e.g. Oracle Fusion Order Management Cloud Service', ai: true },
            { name: 'problem_type', label: 'Problem type', hint: 'As listed by My Oracle Support', ai: true },
            { name: 'severity', label: 'Severity', options: '1,2,3,4', def: '3', hint: '1 only when production is down', ai: true },
            { name: 'environment', label: 'Environment', hint: 'Production or Test, the pod address', ai: true },
            { name: 'impact', label: 'Business impact', hint: 'Who / what is affected, how many orders, deadline', ai: true, long: true },
            { name: 'contact', label: 'Contact', hint: 'Name, e-mail, phone', ai: false }
        ];
        l.notes = '## How to teach this lesson (once)\n' +
            '1. Go to **Teach the clicks** and press **Open browser** — My Oracle Support opens in the Teach Me window. Sign in there (sign-in pages and passwords are never recorded).\n' +
            '2. Press **Record**, then raise an SR the way you always do: Create Technical SR, summary, description, product, problem type, severity, contact …\n' +
            '3. On the last page, press **Submit** for a real SR or stop just before it. A click on a button called Submit is marked ✋ = the replay stops there and never presses it.\n' +
            '4. Press **Stop recording**. On every typed field press **{x}** and pick the variable it is (summary, description …). Check the ✋ is on the Submit step. **Save**.\n\n' +
            '## Every time after that\n' +
            '1. **Run** tab → paste the error / e-mail into *Tell the AI what happened* → **Fill with AI** → check the values.\n' +
            '2. **Run lesson** — the app opens My Oracle Support, fills every page and stops before Submit. You check and press Submit yourself.\n' +
            '3. The app reads the SR number from the page and keeps it in the run history (APEX + this PC).\n\n' +
            '## Tips\n- Attachments: the replay pauses so you can attach the file, then press Continue.\n- If Oracle changes a page and a step is not found, do that step by hand and press Continue; then fix the step here.';
        return l;
    };
    TM.create = function (kind) {
        var l = kind === 'oraclesr' ? TM.ORACLE_SR() : TM.blank(kind);
        TM.cur = l; TM.dirty = true; TM.tab = kind === 'navigation' ? 'teach' : 'lesson';
        lsSet('teachme.cur', l.id);
        TM.paintTree(); TM.paintMain();
    };

    // ── tree ────────────────────────────────────────────────────
    TM.paintTree = function () {
        var q = ($('q').value || '').toLowerCase();
        var list = TM.lessons.filter(function (l) { return l.removed !== 'Y' && (!q || (l.subject + ' ' + l.title + ' ' + (l.tags || '') + ' ' + (l.notes || '')).toLowerCase().indexOf(q) >= 0); });
        if (TM.cur && TM.lessons.indexOf(TM.cur) < 0) list.unshift(TM.cur);
        var subj = {};
        list.forEach(function (l) { var s = l.subject || 'General'; (subj[s] = subj[s] || []).push(l); });
        var names = Object.keys(subj).sort();
        $('tree').innerHTML = names.length ? names.map(function (s) {
            return '<h5><i class="fa-solid fa-folder"></i> ' + esc(s) + '<span class="n">' + subj[s].length + '</span></h5>' + subj[s].sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); }).map(function (l) {
                var ico = l.kind === 'navigation' ? 'fa-route' : 'fa-book-open';
                return '<div class="item' + (TM.cur && TM.cur.id === l.id ? ' on' : '') + '" data-id="' + esc(l.id) + '"><i class="fa-solid ' + ico + '"></i><div>' + esc(l.title) +
                    '<small>' + (l.kind === 'navigation' ? (l.steps || []).length + ' steps · ' + (l.vars || []).length + ' variables' : 'notes') + (l.version ? '' : ' · not saved') + '</small></div></div>';
            }).join('');
        }).join('') : '<div class="empty"><i class="fa-solid fa-graduation-cap"></i>' + (q ? 'Nothing matches.' : 'Nothing taught yet.') + '</div>';
        $('tree').querySelectorAll('.item').forEach(function (el) { el.onclick = function () { TM.open(el.dataset.id); }; });
    };
    TM.open = function (id) {
        if (TM.dirty && TM.cur && TM.cur.id !== id && !confirm('The lesson "' + TM.cur.title + '" has unsaved changes. Leave it without saving?')) return;
        var l = TM.lessons.filter(function (x) { return x.id === id; })[0]; if (!l) return;
        TM.cur = JSON.parse(JSON.stringify(l));
        var i = TM.lessons.indexOf(l); TM.lessons[i] = TM.cur;
        TM.dirty = false; TM.subject = l.subject;
        if (TM.tab === 'teach' || TM.tab === 'vars' || TM.tab === 'run') { if (l.kind !== 'navigation') TM.tab = 'lesson'; } else if (TM.tab !== 'history') TM.tab = 'lesson';
        lsSet('teachme.cur', id);
        TM.paintTree(); TM.paintMain();
    };

    // ── main ────────────────────────────────────────────────────
    TM.paintMain = function () {
        var l = TM.cur, m = $('main');
        if (!l) {
            m.innerHTML = '<div class="card hero"><i class="fa-solid fa-graduation-cap big"></i><div><h2 style="margin:0 0 4px">Teach the app how you do things</h2>' +
                '<p class="muted" style="margin:0">Write down what you know as <b>notes</b>, or <b>show</b> the app a task on a website once — it records your clicks and typing, ' +
                'and later repeats them with new values. It always stops before the final Submit so you stay in control. Everything you teach is saved in APEX and on this PC.</p></div></div>' +
                '<div class="grid2">' +
                [['notes', 'fa-book-open', 'Notes', 'A subject in your own words: how a process works, rules, who to ask, codes.'],
                 ['navigation', 'fa-route', 'Portal navigation', 'Open a website in the Teach Me window, press Record and do the task once.'],
                 ['oraclesr', 'fa-life-ring', 'Oracle Support — raise an SR', 'Ready-made: SR fields as variables, Fill with AI from an error, SR number read back.']].map(function (c) {
                    return '<div class="card" style="cursor:pointer" data-new="' + c[0] + '"><h3><i class="fa-solid ' + c[1] + '"></i> ' + c[2] + '</h3><p class="muted sm" style="margin:0">' + c[3] + '</p></div>';
                }).join('') + '</div>';
            m.querySelectorAll('[data-new]').forEach(function (b) { b.onclick = function () { TM.create(b.dataset.new); }; });
            return;
        }
        var nav = l.kind === 'navigation';
        var tabs = [['lesson', 'fa-book-open', 'Lesson']].concat(nav ? [['teach', 'fa-route', 'Teach the clicks'], ['vars', 'fa-sliders', 'Variables & result'], ['run', 'fa-play', 'Run'], ['history', 'fa-clock-rotate-left', 'History']] : []);
        m.innerHTML = '<div class="head" id="head"></div><div class="tabs">' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (TM.tab === t[0] ? 'on' : '') + '"><i class="fa-solid ' + t[1] + '"></i> ' + t[2] + '</button>'; }).join('') + '</div><div id="body"></div>';
        m.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { TM.tab = b.dataset.tab; TM.paintMain(); }; });
        TM.paintHead();
        ({ lesson: TM.viewLesson, teach: TM.viewTeach, vars: TM.viewVars, run: TM.viewRun, history: TM.viewHistory }[TM.tab] || TM.viewLesson)($('body'));
    };
    TM.paintHead = function () {
        var l = TM.cur, h = $('head'); if (!l || !h) return;
        h.innerHTML = '<input class="t" id="h-title" value="' + esc(l.title) + '">' +
            '<span class="chip ac"><i class="fa-solid ' + (l.kind === 'navigation' ? 'fa-route' : 'fa-book-open') + '"></i> ' + (l.kind === 'navigation' ? 'Portal navigation' : 'Notes') + '</span>' +
            (l.version ? '<span class="chip">v' + l.version + ' · ' + esc(l.changedBy || '') + ' · ' + esc((l.changedAt || '').replace('T', ' ')) + '</span>' : '') +
            (TM.dirty ? '<span class="chip warn">not saved</span>' : '<span class="chip ok">saved</span>') + '<span class="grow"></span>' +
            '<button class="btn primary" id="h-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
            '<button class="btn" id="h-dup" title="Copy this lesson"><i class="fa-regular fa-copy"></i></button>' +
            '<button class="btn" id="h-exp" title="Download as JSON"><i class="fa-solid fa-download"></i></button>' +
            (l.kind === 'navigation' ? '<button class="btn" id="h-pw" title="Export as a Playwright C# script"><i class="fa-solid fa-code"></i> Playwright</button>' : '') +
            '<button class="btn danger" id="h-del" title="Remove"><i class="fa-regular fa-trash-can"></i></button>';
        $('h-title').oninput = function () { l.title = this.value; TM.dirty = true; };
        $('h-title').onchange = function () { TM.paintHead(); TM.paintTree(); };
        $('h-save').onclick = function () { TM.save(); };
        $('h-dup').onclick = function () {
            var c = JSON.parse(JSON.stringify(l)); c.id = newId('L'); c.title = l.title + ' (copy)'; c.version = 0; delete c.createdBy; delete c.removed;
            TM.cur = c; TM.dirty = true; TM.paintTree(); TM.paintMain();
        };
        $('h-exp').onclick = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(l, null, 2)], { type: 'application/json' })); a.download = (l.title || 'lesson').replace(/[^\w-]+/g, '_') + '.lesson.json'; a.click(); };
        if ($('h-pw')) $('h-pw').onclick = function () { TM.exportPlaywright(l); };
        $('h-del').onclick = function () {
            TM.modal('Remove lesson', '<p>Remove <b>' + esc(l.title) + '</b>? It is marked as removed in APEX and on this PC (its runs stay).</p>', [['Cancel', ''], ['Remove', 'ok', 'primary']]).then(function (r) {
                if (r.button !== 'ok') return;
                l.removed = 'Y';
                (l.version ? TM.save(true) : Promise.resolve()).then(function () { TM.lessons = TM.lessons.filter(function (x) { return x !== l; }); TM.cur = null; TM.dirty = false; TM.paintTree(); TM.paintMain(); });
            });
        };
    };

    /** The lesson as a stand-alone Playwright C# program (NuGet Microsoft.Playwright, installed Edge); variables become arguments. */
    TM.exportPlaywright = function (l) {
        var q = function (x) { return '"' + String(x == null ? '' : x).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"'; };
        var val = function (x) {
            var parts = String(x == null ? '' : x).split(/(\{\{\s*\w+\s*\}\})/).filter(function (p) { return p !== ''; });
            if (!parts.length) return '""';
            return parts.map(function (p) { var m = /^\{\{\s*(\w+)\s*\}\}$/.exec(p); return m ? 'V(' + q(m[1]) + ')' : q(p); }).join(' + ');
        };
        var loc = function (t) {
            t = t || {};
            var f = t.frame ? 'page.Frames.First(f => f.Url.Contains(' + q(t.frame) + '))' : 'page.MainFrame';
            if (t.label) return f + '.GetByLabel(' + q(t.label) + ', new() { Exact = true })';
            var role = { button: 'Button', a: 'Link', link: 'Link', option: 'Option', menuitem: 'Menuitem', tab: 'Tab', checkbox: 'Checkbox', radio: 'Radio' }[t.role || t.tag];
            if (t.text && role) return f + '.GetByRole(AriaRole.' + role + ', new() { Name = ' + q(t.text) + ', Exact = true })';
            if (t.placeholder) return f + '.GetByPlaceholder(' + q(t.placeholder) + ', new() { Exact = true })';
            if (t.id) return f + '.Locator(' + q('[id="' + t.id + '"]') + ')';
            if (t.name) return f + '.Locator(' + q((t.tag || '*') + '[name="' + t.name + '"]') + ')';
            if (t.text) return f + '.GetByText(' + q(t.text) + ', new() { Exact = true })';
            return f + '.Locator(' + q(t.css || 'body') + ')';
        };
        var lines = [];
        (l.steps || []).forEach(function (s, i) {
            var c = '// ' + (i + 1) + '. ' + (s.op === 'pause' ? s.note : TM.stepText(s));
            if (s.stop) { lines.push(c + ' - STOP: a person presses this (Teach Me never submits)', 'Console.WriteLine("Filled in - check the page and press it yourself."); Console.ReadLine();'); return; }
            var L = loc(s.t) + '.First';
            lines.push(c);
            if (s.op === 'fill') lines.push('await ' + L + '.FillAsync(' + val(s.value) + ');');
            else if (s.op === 'select') lines.push('await ' + L + '.SelectOptionAsync(new SelectOptionValue { Label = ' + val(s.optText || s.value) + ' });');
            else if (s.op === 'check') lines.push('await ' + L + '.SetCheckedAsync(' + (String(s.value) === 'true') + ');');
            else if (s.op === 'key') lines.push('await ' + L + '.PressAsync("Enter");');
            else if (s.op === 'pause' || s.op === 'upload') lines.push('Console.WriteLine(' + q(s.note || 'Do this step yourself, then press Enter') + '); Console.ReadLine();');
            else lines.push('await ' + L + '.ClickAsync();');
        });
        var vars = (l.vars || []).map(function (v) { return '//   ' + v.name + ' = ' + (v.label || '') + (v.def ? ' (default: ' + v.def + ')' : ''); });
        var code = ['// ' + l.title + ' - exported from Gray\'s WMS Teach Me (' + new Date().toISOString().slice(0, 10) + ')',
            '// dotnet new console; dotnet add package Microsoft.Playwright; paste this into Program.cs; dotnet run -- name=value ...',
            '// Variables (pass as name=value arguments):'].concat(vars.length ? vars : ['//   (none)']).concat([
            'using System;', 'using System.Linq;', 'using Microsoft.Playwright;', '',
            'var vals = args.Select(a => a.Split(\'=\', 2)).Where(p => p.Length == 2).ToDictionary(p => p[0], p => p[1]);',
            'string V(string n) => vals.TryGetValue(n, out var v) ? v : ' + '(new System.Collections.Generic.Dictionary<string, string> { ' + (l.vars || []).map(function (v) { return '[' + q(v.name) + '] = ' + q(v.def || ''); }).join(', ') + ' }.TryGetValue(n, out var d) ? d : "");',
            'using var pw = await Playwright.CreateAsync();',
            'await using var ctx = await pw.Chromium.LaunchPersistentContextAsync(System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TeachMePlaywright"), new() { Channel = "msedge", Headless = false });',
            'var page = ctx.Pages.FirstOrDefault() ?? await ctx.NewPageAsync();',
            'await page.GotoAsync(' + val(l.startUrl) + ');',
            'Console.WriteLine("Sign in if asked, then press Enter."); Console.ReadLine();', ''
        ]).concat(lines).concat(l.capture && l.capture.regex ? ['', '// ' + (l.capture.label || 'result') + ' read from the page', 'var m = System.Text.RegularExpressions.Regex.Match(await page.Locator("body").InnerTextAsync(), ' + q(l.capture.regex) + ');',
            'Console.WriteLine(m.Success ? ' + q((l.capture.label || 'Result') + ': ') + ' + (m.Groups.Count > 1 ? m.Groups[1].Value : m.Value) : "Not found on the page.");'] : []);
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([code.join('\r\n')], { type: 'text/plain' }));
        a.download = (l.title || 'lesson').replace(/[^\w-]+/g, '_') + '.Program.cs'; a.click();
        TM.toast('Playwright C# script downloaded.', 'ok');
    };

    // ── tab: lesson (notes) ─────────────────────────────────────
    TM.viewLesson = function (el) {
        var l = TM.cur, subjects = Array.from(new Set(TM.lessons.map(function (x) { return x.subject; }).filter(Boolean))).sort();
        el.innerHTML = TM.aiBanner(l) + '<div class="card"><div class="form">' +
            '<label>Subject<input type="text" id="f-subject" list="subjects" value="' + esc(l.subject) + '" placeholder="e.g. Oracle Support, Fusion navigation, WMS"></label><datalist id="subjects">' + subjects.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
            '<label>Tags<input type="text" id="f-tags" value="' + esc(l.tags) + '" placeholder="words to find it by"></label>' +
            '<label class="wide">' + (l.kind === 'navigation' ? 'Notes for this lesson (what it is for, what to check)' : 'What you want to teach') +
            '<textarea class="notes" id="f-notes" placeholder="Write it the way you would explain it to a new colleague. Markdown: # heading, - bullet, 1. step, **bold**, `code`.">' + esc(l.notes) + '</textarea></label></div></div>' +
            '<div class="card"><h3><i class="fa-solid fa-eye"></i> Preview</h3><div class="md" id="f-prev"></div></div>';
        var prev = function () { $('f-prev').innerHTML = TM.md(l.notes) || '<p class="muted">Nothing written yet.</p>'; };
        $('f-subject').oninput = function () { l.subject = this.value; TM.touch(); };
        $('f-subject').onchange = function () { TM.subject = l.subject; TM.paintTree(); };
        $('f-tags').oninput = function () { l.tags = this.value; TM.touch(); };
        $('f-notes').oninput = function () { l.notes = this.value; if (!TM.dirty) TM.touch(); prev(); };
        prev();
    };

    // ── tab: teach the clicks ───────────────────────────────────
    TM.OPS = { click: 'fa-arrow-pointer', fill: 'fa-keyboard', select: 'fa-list', check: 'fa-square-check', key: 'fa-turn-down', upload: 'fa-paperclip', pause: 'fa-hand' };
    TM.target = function (t) { t = t || {}; return t.label || t.text || t.placeholder || t.name || t.id || (t.css ? t.css.split('>').slice(-2).join(' › ') : '?'); };
    TM.stepText = function (s) {
        var t = '"' + TM.target(s.t) + '"';
        return { click: 'Click ' + t, fill: 'Type into ' + t, select: 'Choose in ' + t, check: (String(s.value) === 'true' ? 'Tick ' : 'Untick ') + t, key: 'Press Enter in ' + t,
                 upload: 'Attach a file (' + t + ')', pause: 'You do this yourself' }[s.op] || s.op;
    };
    TM.viewTeach = function (el) {
        var l = TM.cur;
        el.innerHTML = '<div class="card"><div class="row"><label class="f" style="flex:1">Start address<input type="url" id="t-url" value="' + esc(l.startUrl) + '" placeholder="https://…"></label>' +
            '<button class="btn" id="t-open" style="margin-top:16px"><i class="fa-solid fa-up-right-from-square"></i> Open browser</button>' +
            '<button class="btn" id="t-here" style="margin-top:16px" title="Use the address now open in the Teach Me window"><i class="fa-solid fa-location-dot"></i> Use current page</button>' +
            '<button class="btn ' + (TM.recording && TM.recFor === l.id ? 'rec' : 'primary') + '" id="t-rec" style="margin-top:16px"><i class="fa-solid ' + (TM.recording && TM.recFor === l.id ? 'fa-stop' : 'fa-circle') + '"></i> ' + (TM.recording && TM.recFor === l.id ? 'Stop recording' : 'Record') + '</button></div>' +
            '<p class="muted sm" style="margin:8px 0 0">Open the site, sign in there if needed, then press <b>Record</b> and do the task in the Teach Me window. Each click and typed value appears below. ' +
            'Sign-in pages and password fields are never recorded. The app never presses a step marked ✋ — that is where it stops for you.</p></div>' +
            (TM.recording && TM.recFor === l.id ? '<div class="rec-bar"><span class="rec-dot"></span><b>Recording</b><span class="muted sm">Do the task in the Teach Me window — ' + esc(TM.lastUrl || '') + '</span></div>' : '') +
            '<div class="card"><h3><i class="fa-solid fa-list-ol"></i> Steps <span class="chip">' + l.steps.length + '</span><span class="grow"></span>' +
            '<button class="btn sm" id="t-pause"><i class="fa-solid fa-hand"></i> Add “I do this myself”</button>' +
            (l.steps.length ? '<button class="btn sm danger" id="t-clear"><i class="fa-regular fa-trash-can"></i> Clear all</button>' : '') + '</h3><div class="steps" id="t-steps"></div></div>';
        $('t-url').oninput = function () { l.startUrl = this.value.trim(); TM.touch(); };
        $('t-open').onclick = function () {
            var u = TM.startOf(l) || TM.lastUrl; if (!/^https:\/\//i.test(u || '')) { TM.toast('Type a start address that begins with https://', 'err'); return; }
            hostOk('teachOpen', { url: u }).catch(function (e) { TM.toast(String(e), 'err'); });
        };
        $('t-here').onclick = function () { if (!TM.lastUrl) { TM.toast('Open the browser first.', 'err'); return; } l.startUrl = TM.lastUrl; $('t-url').value = l.startUrl; TM.touch(); };
        $('t-rec').onclick = TM.toggleRecord;
        $('t-pause').onclick = function () {
            TM.modal('Add a step you do yourself', '<label class="f">What should the person do?<input type="text" id="m-note" value="Check the page"></label>').then(function (r) {
                if (r.button !== 'ok') return; l.steps.push({ op: 'pause', note: r.box.querySelector('#m-note').value || 'Do this step yourself' }); TM.touch(); TM.paintSteps();
            });
        };
        if ($('t-clear')) $('t-clear').onclick = function () { if (confirm('Remove all ' + l.steps.length + ' steps?')) { l.steps = []; TM.touch(); TM.paintMain(); } };
        TM.paintSteps();
    };
    TM.paintSteps = function () {
        var l = TM.cur, box = $('t-steps'); if (!box) return;
        box.innerHTML = l.steps.length ? l.steps.map(function (s, i) {
            var typed = s.op === 'fill' || s.op === 'select';
            var hasVar = /\{\{\s*\w+\s*\}\}/.test(String(s.value || '') + String(s.optText || ''));
            return '<div class="step' + (s.stop ? ' stop' : '') + (s.op === 'pause' ? ' pause' : '') + '" data-i="' + i + '"><span class="n">' + (i + 1) + '</span><i class="fa-solid ' + (TM.OPS[s.op] || 'fa-circle') + ' op"></i>' +
                '<div class="what"><b>' + esc(s.op === 'pause' ? s.note : TM.stepText(s)) + '</b>' + (s.stop ? ' <span class="chip warn">✋ stops here — you press it</span>' : '') + (s.optional ? ' <span class="chip">optional</span>' : '') +
                (s.t && s.t.page ? '<div class="sm">' + esc(s.t.page) + (s.t.frame ? ' · in a frame' : '') + '</div>' : '') +
                (typed ? '<input type="text" class="val" data-val="' + i + '" value="' + esc(s.op === 'select' && s.optText ? s.optText : s.value) + '"' + (hasVar ? ' style="border-color:#a78bfa;background:#faf5ff"' : '') + '>' : '') + '</div>' +
                '<div class="acts">' + (typed ? '<button class="icon" data-x="var" title="Make this a variable ({{name}})">{x}</button>' : '') +
                (s.op !== 'pause' ? '<button class="icon' + (s.stop ? ' on' : '') + '" data-x="stop" title="Stop here — the person presses this (Submit)"><i class="fa-solid fa-hand"></i></button>' +
                    '<button class="icon' + (s.optional ? ' on' : '') + '" data-x="opt" title="Optional — skip it when it is not on the page"><i class="fa-solid fa-circle-question"></i></button>' : '') +
                '<button class="icon" data-x="up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button><button class="icon" data-x="down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>' +
                '<button class="icon" data-x="del" title="Remove"><i class="fa-regular fa-trash-can"></i></button></div></div>';
        }).join('') : '<div class="empty"><i class="fa-solid fa-route"></i>No steps yet — open the site and press Record.</div>';
        box.querySelectorAll('[data-val]').forEach(function (inp) {
            inp.oninput = function () { var s = l.steps[+inp.dataset.val]; if (s.op === 'select' && s.optText != null) s.optText = inp.value; else s.value = inp.value; if (!TM.dirty) TM.touch(); };
        });
        box.querySelectorAll('[data-x]').forEach(function (b) {
            b.onclick = function () {
                var i = +b.closest('[data-i]').dataset.i, s = l.steps[i], x = b.dataset.x;
                if (x === 'del') l.steps.splice(i, 1);
                else if (x === 'up' && i > 0) l.steps.splice(i - 1, 0, l.steps.splice(i, 1)[0]);
                else if (x === 'down' && i < l.steps.length - 1) l.steps.splice(i + 1, 0, l.steps.splice(i, 1)[0]);
                else if (x === 'stop') s.stop = !s.stop;
                else if (x === 'opt') s.optional = !s.optional;
                else if (x === 'var') { TM.makeVar(i); return; }
                TM.touch(); TM.paintSteps();
            };
        });
    };
    TM.slug = function (s) { return String(s || 'value').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'value'; };
    TM.makeVar = function (i) {
        var l = TM.cur, s = l.steps[i], cur = s.op === 'select' && s.optText != null ? s.optText : s.value;
        var guess = TM.slug(s.t && (s.t.label || s.t.placeholder || s.t.name));
        TM.modal('Make "' + esc(TM.target(s.t)) + '" a variable', '<p class="muted sm">A variable is filled in at each run (by you or by the AI) instead of the value you typed while teaching.</p>' +
            '<div class="form"><label>Use variable<select id="m-pick"><option value="">— a new variable —</option>' + l.vars.map(function (v) { return '<option value="' + esc(v.name) + '">' + esc(v.label || v.name) + ' ({{' + esc(v.name) + '}})</option>'; }).join('') + '</select></label>' +
            '<label>New variable name<input type="text" id="m-name" value="' + esc(guess) + '"></label><label class="wide">Label<input type="text" id="m-label" value="' + esc(s.t && (s.t.label || s.t.placeholder) || guess) + '"></label></div>').then(function (r) {
                if (r.button !== 'ok') return;
                var name = r.box.querySelector('#m-pick').value || TM.slug(r.box.querySelector('#m-name').value);
                if (!l.vars.some(function (v) { return v.name === name; }))
                    l.vars.push({ name: name, label: r.box.querySelector('#m-label').value || name, def: /\{\{/.test(cur || '') ? '' : (cur || ''), ai: true });
                if (s.op === 'select' && s.optText != null) s.optText = '{{' + name + '}}'; else s.value = '{{' + name + '}}';
                TM.touch(); TM.paintSteps();
            });
    };
    TM.toggleRecord = function () {
        var l = TM.cur, on = !(TM.recording && TM.recFor === l.id);
        if (on && !TM.startOf(l) && !TM.lastUrl) { TM.toast('Type the start address and press Open browser first.', 'err'); return; }
        var go = on && !TM.lastUrl ? hostOk('teachOpen', { url: TM.startOf(l) }).then(function () { return new Promise(function (r) { setTimeout(r, 1500); }); }) : Promise.resolve();
        go.then(function () { return hostOk('teachRecord', { on: on }); }).then(function (d) {
            TM.recording = !!d.recording; TM.recFor = TM.recording ? l.id : null;
            if (TM.recording && !l.startUrl && d.url) { l.startUrl = d.url; TM.touch(); }
            if (!TM.recording && TM.dirty) TM.toast(l.steps.length + ' steps recorded — check them, make the typed values variables ({x}) and Save.', 'ok');
            TM.paintMain();
        }).catch(function (e) { TM.toast(String(e), 'err'); });
    };
    TM.SUBMIT_WORDS = /^\s*(submit|submit sr|submit request|send|create|create sr|create service request|finish|confirm and submit)\s*$/i;
    TM.addStep = function (step) {
        var l = TM.lessons.concat(TM.cur ? [TM.cur] : []).filter(function (x) { return x.id === TM.recFor; })[0];
        if (!l || !step || !step.op) return;
        var last = l.steps[l.steps.length - 1], same = function (a, b) { return a && b && a.css === b.css && a.frame === b.frame && a.id === b.id; };
        if (last && (step.op === 'fill' || step.op === 'select') && last.op === step.op && same(last.t, step.t)) { last.value = step.value; last.optText = step.optText; }
        else {
            delete step.ts;
            if (step.op === 'click' && step.t && TM.SUBMIT_WORDS.test(step.t.text || step.t.label || '')) { step.stop = true; TM.toast('“' + TM.target(step.t) + '” is marked ✋ — the replay stops there and you press it.', 'ok'); }
            l.steps.push(step);
        }
        if (l === TM.cur) { TM.dirty = true; if (TM.tab === 'teach') { TM.paintSteps(); var b = $('t-steps'); if (b && b.lastElementChild) b.lastElementChild.scrollIntoView({ block: 'nearest' }); } TM.paintHead(); }
    };

    // ── tab: variables & result ─────────────────────────────────
    TM.usedVars = function (l) {
        var used = {};
        (l.steps || []).forEach(function (s) { (String(s.value || '') + ' ' + String(s.optText || '') + ' ' + String(s.note || '')).replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, n) { used[n] = (used[n] || 0) + 1; }); });
        return used;
    };
    TM.viewVars = function (el) {
        var l = TM.cur, used = TM.usedVars(l);
        Object.keys(used).forEach(function (n) { if (!l.vars.some(function (v) { return v.name === n; })) l.vars.push({ name: n, label: n, ai: true }); });
        el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-sliders"></i> Variables <span class="muted sm">— the parts that change on every run. Steps use them as {{name}}.</span><span class="grow"></span><button class="btn sm" id="v-add"><i class="fa-solid fa-plus"></i> Add</button></h3>' +
            '<table class="vars"><thead><tr><th>Name</th><th>Label</th><th>Hint for the AI / person</th><th>Allowed values</th><th>Default</th><th>AI fills</th><th>Used</th><th></th></tr></thead><tbody>' +
            l.vars.map(function (v, i) {
                return '<tr data-i="' + i + '"><td class="mono">{{' + esc(v.name) + '}}</td><td><input type="text" data-k="label" value="' + esc(v.label) + '"></td><td><input type="text" data-k="hint" value="' + esc(v.hint) + '"></td>' +
                    '<td><input type="text" data-k="options" value="' + esc(v.options) + '" placeholder="a, b, c"></td><td><input type="text" data-k="def" value="' + esc(v.def) + '"></td>' +
                    '<td style="text-align:center"><input type="checkbox" data-k="ai"' + (v.ai !== false ? ' checked' : '') + '></td><td>' + (used[v.name] || 0) + '</td>' +
                    '<td><button class="icon" data-del="' + i + '"><i class="fa-regular fa-trash-can"></i></button></td></tr>';
            }).join('') + '</tbody></table>' + (l.vars.length ? '' : '<div class="empty">No variables yet — press {x} on a typed step in Teach the clicks.</div>') + '</div>' +
            '<div class="card"><h3><i class="fa-solid fa-magnifying-glass"></i> Result to read from the page</h3><p class="muted sm" style="margin:0 0 8px">After you press the final button, the app watches the page for this and saves it with the run (e.g. the SR number).</p>' +
            '<div class="form"><label>What it is<input type="text" id="c-label" value="' + esc(l.capture && l.capture.label) + '" placeholder="SR number"></label>' +
            '<label>Pattern (regular expression)<input type="text" id="c-re" class="mono" value="' + esc(l.capture && l.capture.regex) + '" placeholder="\\b(3-\\d{8,12})\\b"></label></div>' +
            '<div class="row" style="margin-top:8px"><button class="btn sm" id="c-sr">Oracle SR number</button><button class="btn sm" id="c-num">Any reference number</button><button class="btn sm" id="c-none">None</button></div></div>';
        el.querySelectorAll('tr[data-i] [data-k]').forEach(function (inp) {
            inp.oninput = inp.onchange = function () { var v = l.vars[+inp.closest('tr').dataset.i]; v[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value; if (!TM.dirty) TM.touch(); };
        });
        el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { l.vars.splice(+b.dataset.del, 1); TM.touch(); TM.paintMain(); }; });
        $('v-add').onclick = function () { l.vars.push({ name: 'value' + (l.vars.length + 1), label: 'New value', ai: true }); TM.touch(); TM.paintMain(); };
        var cap = function (re, label) { l.capture = { regex: re, label: label }; TM.touch(); TM.paintMain(); };
        $('c-label').oninput = function () { l.capture = l.capture || {}; l.capture.label = this.value; TM.touch(); };
        $('c-re').oninput = function () { l.capture = l.capture || {}; l.capture.regex = this.value; TM.touch(); };
        $('c-sr').onclick = function () { cap('\\b(3-\\d{8,12})\\b', 'SR number'); };
        $('c-num').onclick = function () { cap('(?:number|no\\.?|reference|ref)\\s*[:#]?\\s*([A-Z0-9-]{4,})', 'Reference number'); };
        $('c-none').onclick = function () { cap('', ''); };
    };

    // ── tab: run ────────────────────────────────────────────────
    TM.values = {};
    TM.viewRun = function (el) {
        var l = TM.cur, vals = TM.values[l.id] = TM.values[l.id] || {};
        l.vars.forEach(function (v) { if (vals[v.name] == null) vals[v.name] = v.def || ''; });
        var r = TM.run && TM.run.lessonId === l.id ? TM.run : null, busy = r && !r.ended;
        var stop = (l.steps || []).filter(function (s) { return s.stop; })[0], pad = TM.engineOf(l) === 'pad';
        l.pad = l.pad || {};
        el.innerHTML = (pad ? '' : l.steps.length ? '' : '<div class="banner warn"><i class="fa-solid fa-triangle-exclamation"></i> Nothing to run yet — teach the clicks first.</div>') +
            (!pad && l.steps.length && !stop ? '<div class="banner warn"><i class="fa-solid fa-hand"></i> No step is marked ✋. The run will press every step — mark the Submit click in Teach the clicks if it should stop there.</div>' : '') +
            '<div class="card"><h3><i class="fa-solid fa-wand-magic-sparkles"></i> Tell the AI what happened <span class="muted sm">— it fills the values below</span></h3>' +
            '<textarea id="r-ai" rows="5" style="width:100%" placeholder="Paste the error, the e-mail, the steps — anything the form needs.">' + esc(TM.aiText || '') + '</textarea>' +
            '<div class="row" style="margin-top:8px"><button class="btn" id="r-fill"><i class="fa-solid fa-wand-magic-sparkles"></i> Fill with AI</button><span class="muted sm" id="r-ainote"></span></div></div>' +
            '<div class="card"><h3><i class="fa-solid fa-sliders"></i> Values for this run</h3><div class="form">' +
            (l.vars.length ? l.vars.map(function (v) {
                var opts = String(v.options || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), val = vals[v.name] || '';
                var input = opts.length ? '<select data-v="' + esc(v.name) + '"><option value=""></option>' + opts.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'
                    : (v.long || /desc|steps|error|impact|notes/.test(v.name) ? '<textarea data-v="' + esc(v.name) + '" rows="4">' + esc(val) + '</textarea>' : '<input type="text" data-v="' + esc(v.name) + '" value="' + esc(val) + '">');
                return '<label class="' + (/<textarea/.test(input) ? 'wide' : '') + '" title="' + esc(v.hint || '') + '">' + esc(v.label || v.name) + input + (v.hint ? '<span style="text-transform:none;font-weight:400">' + esc(v.hint) + '</span>' : '') + '</label>';
            }).join('') : '<p class="muted">This lesson has no variables — it repeats exactly what you taught.</p>') + '</div></div>' +
            '<div class="card"><h3><i class="fa-solid fa-gears"></i> Run with</h3><div class="engines">' + TM.ENGINES.map(function (e) {
                return '<label class="eng' + (TM.engineOf(l) === e.id ? ' on' : '') + '"><input type="radio" name="r-eng" value="' + e.id + '"' + (TM.engineOf(l) === e.id ? ' checked' : '') + '><i class="fa-solid ' + e.icon + '"></i><span><b>' + e.label + '</b><small>' + e.note + '</small></span></label>';
            }).join('') + '</div>' + (TM.engineOf(l) === 'playwright-headless' && stop ? '<div class="banner warn" style="margin:8px 0 0"><i class="fa-solid fa-hand"></i> Headless runs stop at the ✋ step and nobody can press it — use it for lessons that only read, or run visible to submit.</div>' : '') + '</div>' +
            (pad ? TM.padCard(l) : '') +
            '<div class="card"><div class="row"><button class="btn primary" id="r-go"' + (busy || !(pad ? (l.pad.flowName || l.pad.flowId) : l.steps.length) ? ' disabled' : '') + '><i class="fa-solid fa-play"></i> Run lesson</button>' +
            '<button class="btn" id="r-cont"' + (busy && r.waiting ? '' : ' disabled') + '><i class="fa-solid fa-forward"></i> Continue</button>' +
            '<button class="btn danger" id="r-stop"' + (busy ? '' : ' disabled') + '><i class="fa-solid fa-stop"></i> Stop</button>' +
            '<button class="btn" id="r-copy"><i class="fa-regular fa-copy"></i> Copy all values</button><span class="grow"></span><span class="muted sm">The app never presses a ✋ step.</span></div></div>' +
            '<div id="r-live"></div>';
        el.querySelectorAll('[data-v]').forEach(function (inp) { inp.oninput = inp.onchange = function () { vals[inp.dataset.v] = inp.value; }; });
        el.querySelectorAll('input[name=r-eng]').forEach(function (r) { r.onchange = function () { l.engine = r.value; lsSet('teachme.engine', r.value); TM.touch(); TM.paintMain(); }; });
        $('r-ai').oninput = function () { TM.aiText = this.value; };
        $('r-fill').onclick = function () { TM.aiFill(this); };
        $('r-go').onclick = pad ? TM.startPad : TM.startRun;
        if (pad) TM.wirePad(l);
        $('r-cont').onclick = function () { hostOk('teachContinue').then(function () { if (TM.run) TM.run.waiting = false; TM.paintMain(); }); };
        $('r-stop').onclick = function () { hostOk('teachStop'); };
        $('r-copy').onclick = function () {
            var t = l.vars.map(function (v) { return (v.label || v.name) + ':\n' + (vals[v.name] || '') + '\n'; }).join('\n');
            navigator.clipboard.writeText(t).then(function () { TM.toast('Copied.'); });
        };
        TM.paintLive();
    };
    TM.aiFill = function (btn) {
        var l = TM.cur, vals = TM.values[l.id];
        if (!(TM.aiText || '').trim()) { TM.toast('Write or paste what happened first.', 'err'); return; }
        btn.disabled = true; $('r-ainote').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Asking Claude…';
        hostOk('teachAiFill', { text: TM.aiText, lesson: { subject: l.subject, title: l.title, notes: (l.notes || '').slice(0, 6000), vars: l.vars.filter(function (v) { return v.ai !== false; }).map(function (v) { return { name: v.name, label: v.label, hint: v.hint, allowed: v.options, current: vals[v.name] }; }) } })
            .then(function (d) {
                var res = d.result || {}, got = res.values || {}, n = 0;
                Object.keys(got).forEach(function (k) { if (got[k] != null && String(got[k]).trim() !== '' && l.vars.some(function (v) { return v.name === k; })) { vals[k] = String(got[k]); n++; } });
                TM.paintMain();
                $('r-ainote').innerHTML = esc(n + ' value(s) filled' + (res.missing && res.missing.length ? ' · still missing: ' + res.missing.join(', ') : '') + (res.note ? ' · ' + res.note : '') + (d.cost ? ' · $' + (+d.cost).toFixed(4) : ''));
            })
            .catch(function (e) { $('r-ainote').textContent = String(e); })
            .then(function () { btn.disabled = false; });
    };
    TM.ENGINES = [
        { id: 'native', icon: 'fa-window-maximize', label: 'Native — Teach Me window', note: 'The app\'s own browser, same window you taught in. You watch every step; nothing to install.' },
        { id: 'playwright', icon: 'fa-masks-theater', label: 'Playwright — Edge, visible', note: 'Microsoft Playwright drives the installed Edge: smarter element finding, auto-waits, a screenshot per step and a trace file.' },
        { id: 'playwright-headless', icon: 'fa-ghost', label: 'Playwright — headless', note: 'No window: for lessons that only read or need no person. Sign in once with the visible Playwright run first.' },
        { id: 'pad', icon: 'fa-diagram-project', label: 'Power Automate Desktop', note: 'Starts a desktop flow you built in Microsoft\'s Power Automate Desktop, with these values as its inputs. Can also drive Windows programs, not only web pages.' }
    ];

    // ── engine: Power Automate Desktop ──────────────────────────
    TM.padCard = function (l) {
        var names = l.vars.map(function (v) { return v.name; });
        return '<div class="card"><h3><i class="fa-solid fa-diagram-project"></i> Power Automate Desktop flow</h3>' +
            '<div class="form"><label>Flow name<input type="text" id="p-name" value="' + esc(l.pad.flowName || '') + '" placeholder="e.g. Raise Oracle SR"></label>' +
            '<label>Flow id <span style="text-transform:none;font-weight:400">(optional — more exact than the name)</span><input type="text" id="p-id" value="' + esc(l.pad.flowId || '') + '" placeholder="1a2b3c4d-…"></label>' +
            '<label>Environment id <span style="text-transform:none;font-weight:400">(optional, with the id)</span><input type="text" id="p-env" value="' + esc(l.pad.envId || '') + '" placeholder="Default-…"></label></div>' +
            '<div class="banner info" style="margin:10px 0 0"><i class="fa-solid fa-circle-info"></i><div class="grow sm">How it works: build the flow once in Power Automate Desktop (its own recorder and designer — Teach Me\'s steps are not used). ' +
            'Create one <b>input variable</b> per value below with exactly these names: <span class="mono">' + (names.length ? names.map(esc).join(', ') : '(no variables yet)') + '</span>. ' +
            'Run hands them over and Power Automate Desktop runs the flow on its own — Windows asks you to allow it the first time. Nothing comes back to the app, so type the result (e.g. the SR number) in when the flow is done. ' +
            'The flow id is in Power Automate Desktop › the flow\'s ⋮ › Properties › Details (Run URL).</div></div>' +
            '<details style="margin-top:10px"' + (l.pad.flowName || l.pad.flowId ? '' : ' open') + '><summary><b>First time: create the flow in Power Automate Desktop</b></summary><ol class="sm" style="margin:6px 0 0 18px;padding:0;line-height:1.7">' +
            '<li><b>Open Power Automate Desktop</b> (button below) and sign in.</li>' +
            '<li><b>+ New flow</b> → name it exactly <span class="mono">' + esc(l.pad.flowName || '(type the flow name above first)') + '</span> → Create. The designer opens.</li>' +
            '<li>In the <b>Variables</b> pane (right) → <b>+</b> → <b>Input</b>: add one input variable per value, with exactly these names: <span class="mono">' + (names.length ? names.map(esc).join(', ') : '(no variables yet)') + '</span> (Data type Text).</li>' +
            '<li>Build the steps: <b>Recorder</b> (top bar) → Start recording → do the task in the browser / program → Finish. Then replace each typed value in the recorded actions with its variable, e.g. <span class="mono">%summary%</span>.</li>' +
            '<li>Stop before the final Submit / Save if a person should check it (leave that click out of the flow).</li>' +
            '<li><b>Save</b> the flow. Back here, press <b>Run lesson</b>.</li></ol>' +
            '<p class="muted sm" style="margin:4px 0 0">If Power Automate says <i>“A flow with the specified name or ID wasn\'t found”</i>, the flow is not created / saved yet, or its name differs (spelling, spaces) — or put the flow id instead.</p></details>' +
            '<div class="row" style="margin-top:8px"><button class="btn sm" id="p-open"><i class="fa-solid fa-diagram-project"></i> Open Power Automate Desktop</button>' +
            '<button class="btn sm" id="p-copyname"><i class="fa-regular fa-copy"></i> Copy the flow name</button>' +
            '<button class="btn sm" id="p-copy"><i class="fa-regular fa-copy"></i> Copy the input variable names</button></div></div>';
    };
    TM.wirePad = function (l) {
        var set = function (k) { return function () { l.pad[k] = this.value.trim(); TM.touch(); var g = $('r-go'); if (g) g.disabled = !(l.pad.flowName || l.pad.flowId) || (TM.run && !TM.run.ended); }; };
        $('p-name').oninput = set('flowName'); $('p-id').oninput = set('flowId'); $('p-env').oninput = set('envId');
        $('p-open').onclick = function () { hostOk('teachPadOpen').catch(function (e) { TM.toast(String(e), 'err'); }); };
        $('p-copyname').onclick = function () { if (!l.pad.flowName) { TM.toast('Type the flow name first.', 'err'); return; } navigator.clipboard.writeText(l.pad.flowName).then(function () { TM.toast('Flow name copied — paste it as the name of the new flow.'); }); };
        $('p-copy').onclick = function () { navigator.clipboard.writeText(l.vars.map(function (v) { return v.name; }).join('\n')).then(function () { TM.toast('Copied — create these as input variables in the flow.'); }); };
    };
    TM.startPad = function () {
        var l = TM.cur, vals = TM.values[l.id] || {};
        if (TM.dirty) { TM.toast('Save the lesson first.', 'err'); return; }
        var inputs = {}; l.vars.forEach(function (v) { inputs[v.name] = String(vals[v.name] == null ? '' : vals[v.name]); });
        var runId = newId('R');
        TM.run = { id: runId, lessonId: l.id, lessonTitle: l.title, lessonVersion: l.version, startedAt: now(), log: [], values: JSON.parse(JSON.stringify(vals)), n: 1, i: -1, state: 'start', engine: 'pad' };
        TM.run.log.push({ at: now(), state: 'start', message: 'Handing ' + Object.keys(inputs).length + ' value(s) to Power Automate Desktop flow "' + (l.pad.flowName || l.pad.flowId) + '"' });
        TM.paintMain();
        hostOk('teachPadRun', { flowName: l.pad.flowName, flowId: l.pad.flowId, envId: l.pad.envId, inputs: inputs, title: l.title }).then(function (d) {
            var r = TM.run; r.ended = true; r.final = 'launched'; r.i = 0; r.padWaiting = true;
            r.log.push({ at: now(), state: 'ready', message: 'Started: ' + d.url });
            TM.paintMain();
        }).catch(function (e) {
            var r = TM.run; r.ended = true; r.final = 'error'; r.message = String(e); r.log.push({ at: now(), state: 'error', message: String(e) });
            TM.finishRun(r); TM.paintMain();
        });
    };
    TM.engineOf = function (l) { var e = l.engine || lsGet('teachme.engine', 'native'); return TM.ENGINES.some(function (x) { return x.id === e; }) ? e : 'native'; };
    TM.resolve = function (s, vals) { return String(s == null ? '' : s).replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, n) { return vals[n] != null ? vals[n] : ''; }); };
    TM.startRun = function () {
        var l = TM.cur, vals = TM.values[l.id] || {};
        if (TM.dirty) { TM.toast('Save the lesson first.', 'err'); return; }
        var missing = Object.keys(TM.usedVars(l)).filter(function (n) { return !String(vals[n] || '').trim(); });
        var go = missing.length ? TM.modal('Some values are empty', '<p>These are used by steps but have no value: <b>' + missing.map(esc).join(', ') + '</b>. Run anyway (they are left empty)?</p>', [['Cancel', ''], ['Run anyway', 'ok', 'primary']]).then(function (r) { return r.button === 'ok'; }) : Promise.resolve(true);
        go.then(function (ok) {
            if (!ok) return;
            if (TM.recording) return TM.toast('Stop recording first.', 'err');
            var steps = l.steps.map(function (s) {
                var c = JSON.parse(JSON.stringify(s));
                if (c.value != null) c.value = TM.resolve(c.value, vals);
                if (c.optText != null) c.optText = TM.resolve(c.optText, vals);
                if (c.note) c.note = TM.resolve(c.note, vals);
                c.what = c.op === 'pause' ? c.note : TM.stepText(c);
                return c;
            });
            var runId = newId('R');
            TM.run = { id: runId, lessonId: l.id, lessonTitle: l.title, lessonVersion: l.version, startedAt: now(), log: [], values: JSON.parse(JSON.stringify(vals)), n: steps.length, i: -1, state: 'start' };
            TM.paintMain();
            TM.run.engine = TM.engineOf(l);
            hostOk('teachRun', { runId: runId, url: TM.startOf(l, vals), steps: steps, capture: l.capture && l.capture.regex || '', title: l.title, engine: TM.run.engine }).catch(function (e) {
                TM.run.ended = true; TM.run.final = 'error'; TM.run.message = String(e); TM.paintMain();
            });
        });
    };
    TM.paintLive = function () {
        var box = $('r-live'), r = TM.run; if (!box || !r || !TM.cur || r.lessonId !== TM.cur.id) { if (box) box.innerHTML = ''; return; }
        var pct = r.n ? Math.round(Math.max(0, r.i + 1) / r.n * 100) : 0;
        var head = r.ended
            ? ({ captured: ['ok', 'fa-circle-check', (TM.cur.capture && TM.cur.capture.label || 'Result') + ' read from the page'], ready: ['ok', 'fa-hand', 'Filled in — you pressed (or still press) the final button yourself'], finished: ['ok', 'fa-circle-check', 'All steps done'], launched: ['ok', 'fa-diagram-project', 'Handed to Power Automate Desktop (allow it if Windows asks). If it says the flow wasn\'t found, create and save a flow with exactly this name first — see “First time” above.'],
                stopped: ['warn', 'fa-stop', 'Stopped'], error: ['err', 'fa-triangle-exclamation', r.message || 'Failed'] }[r.final] || ['info', 'fa-info', r.final])
            : r.state === 'login' ? ['warn', 'fa-key', 'Sign in in the Teach Me window — the run carries on by itself']
            : r.state === 'pause' || r.state === 'help' ? ['warn', 'fa-hand', r.message]
            : r.state === 'ready' ? ['ok', 'fa-hand', r.message]
            : r.state === 'watch' ? ['info', 'fa-eye', r.message]
            : ['info', 'fa-circle-notch fa-spin', 'Step ' + (r.i + 1) + ' of ' + r.n + (r.message ? ': ' + r.message : '')];
        box.innerHTML = '<div class="banner ' + head[0] + '"><i class="fa-solid ' + head[1] + '"></i><div class="grow">' + esc(head[2]) + (r.ended ? '' : '<div style="height:5px;background:rgba(0,0,0,.08);border-radius:3px;margin-top:6px"><div style="height:5px;border-radius:3px;background:currentColor;width:' + pct + '%"></div></div>') + '</div></div>' +
            (r.ended && r.folder ? '<div class="card"><div class="row"><i class="fa-solid fa-images" style="color:var(--accent)"></i><span>Screenshots of every step and a Playwright trace (open it with <code>playwright show-trace trace.zip</code> or trace.playwright.dev).</span><span class="grow"></span><button class="btn sm" id="r-folder"><i class="fa-regular fa-folder-open"></i> Open folder</button></div></div>' : '') +
            (r.padWaiting ? '<div class="card"><h3><i class="fa-solid fa-hashtag"></i> When the flow is done</h3><div class="row"><input type="text" id="p-res" placeholder="' + esc(TM.cur.capture && TM.cur.capture.label || 'Result') + ' (optional)" style="flex:1"><button class="btn primary sm" id="p-save"><i class="fa-solid fa-floppy-disk"></i> Save run</button></div></div>' : '') +
            (r.captured ? '<div class="card"><h3><i class="fa-solid fa-hashtag"></i> ' + esc(TM.cur.capture.label || 'Result') + '</h3><div class="row"><span class="captured">' + esc(r.captured) + '</span><button class="btn sm" id="r-capcopy"><i class="fa-regular fa-copy"></i> Copy</button></div></div>' : '') +
            '<div class="card"><h3><i class="fa-solid fa-list-check"></i> What happened</h3><div class="log">' + r.log.map(function (x) {
                return '<div><time>' + esc(x.at.slice(11)) + '</time><span class="chip ' + ({ done: 'ok', error: 'err', help: 'warn', pause: 'warn', login: 'warn', skip: '', ready: 'ok', captured: 'ok' }[x.state] || 'info') + '">' + esc(x.state) + '</span><span>' + esc(x.message || '') + '</span></div>';
            }).join('') + '</div></div>';
        var fo = $('r-folder'); if (fo) fo.onclick = function () { hostOk('teachRunFolder', { runId: r.folder }).catch(function (e) { TM.toast(String(e), 'err'); }); };
        var ps = $('p-save'); if (ps) ps.onclick = function () {
            var v = $('p-res').value.trim(); r.padWaiting = false; r.final = v ? 'captured' : 'finished'; if (v) r.captured = v;
            r.log.push({ at: now(), state: r.final, message: v ? 'Result typed in: ' + v : 'Flow done' }); TM.finishRun(r); TM.paintMain();
        };
        var c = $('r-capcopy'); if (c) c.onclick = function () { navigator.clipboard.writeText(r.captured).then(function () { TM.toast('Copied.'); }); };
    };
    TM.finishRun = function (r) {
        var rec = { id: r.id, lessonId: r.lessonId, lessonTitle: r.lessonTitle, lessonVersion: r.lessonVersion, runBy: TM.user, startedAt: r.startedAt, finishedAt: now(),
                    status: r.final + (r.engine && r.engine !== 'native' ? ' · ' + r.engine : ''), result: r.captured || (r.final === 'error' ? (r.message || '').slice(0, 400) : ''), values: JSON.stringify(r.values), log: JSON.stringify(r.log) };
        hostOk('teachRunSave', { run: rec }).catch(function (e) { TM.toast('Run not saved on this PC: ' + e, 'err'); });
        A.saveRun(rec).catch(function (e) { TM.toast('Run not saved in APEX: ' + e, 'err'); });
    };

    // ── tab: history ────────────────────────────────────────────
    TM.viewHistory = function (el) {
        var l = TM.cur;
        el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-clock-rotate-left"></i> Runs of this lesson <span class="muted sm">— this PC and APEX (every PC)</span></h3><div id="h-list"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>';
        Promise.all([TM.host('teachRuns', { lessonId: l.id }).then(function (d) { return d.runs || []; }, function () { return []; }),
                     A.runs(l.id).then(function (r) { return r.map(function (x) { return { id: x.ID, runBy: x.RUN_BY, startedAt: x.STARTED_AT, status: x.STATUS, result: x.RESULT, apex: true }; }); }, function () { return []; })])
            .then(function (res) {
                var by = {}; res[0].concat(res[1]).forEach(function (r) { by[r.id] = Object.assign(by[r.id] || {}, r, { pc: by[r.id] && by[r.id].pc || !r.apex, apex: (by[r.id] && by[r.id].apex) || r.apex }); });
                var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return String(b.startedAt).localeCompare(String(a.startedAt)); });
                $('h-list').innerHTML = list.length ? '<table class="vars"><thead><tr><th>Started</th><th>By</th><th>Status</th><th>Result</th><th>Saved</th></tr></thead><tbody>' + list.map(function (r) {
                    return '<tr><td>' + esc(String(r.startedAt || '').replace('T', ' ')) + '</td><td>' + esc(r.runBy) + '</td><td><span class="chip ' + ({ captured: 'ok', ready: 'ok', finished: 'ok', error: 'err', stopped: 'warn' }[r.status] || '') + '">' + esc(r.status) + '</span></td>' +
                        '<td class="mono">' + esc(r.result) + '</td><td class="sm">' + (r.pc ? 'this PC ' : '') + (r.apex ? 'APEX' : '') + '</td></tr>';
                }).join('') + '</tbody></table>' : '<div class="empty">No runs yet.</div>';
            });
    };

    // ── events from the host ────────────────────────────────────
    TM.onEvent = function (e) {
        if (e.kind === 'step') { TM.addStep(e.step); return; }
        if (e.kind === 'nav') { TM.lastUrl = e.url || ''; if (TM.recording && TM.tab === 'teach') { var b = document.querySelector('.rec-bar .muted'); if (b) b.textContent = 'Do the task in the Teach Me window — ' + TM.lastUrl; } return; }
        if (e.kind === 'blocked') { TM.toast('The Teach Me window only opens https:// pages (' + e.url + ').', 'err'); return; }
        if (e.kind === 'closed') { TM.recording = false; TM.recFor = null; TM.lastUrl = ''; if (TM.cur && TM.tab === 'teach') TM.paintMain(); return; }
        if (e.kind === 'run' && TM.run && (!e.runId || e.runId === TM.run.id)) {
            var r = TM.run;
            if (e.state === 'end') {
                r.ended = true; r.final = e.final; r.message = e.message; if (e.captured) r.captured = e.captured; r.folder = e.folder; r.engineName = e.engine;
                r.log.push({ at: now(), state: e.final, message: e.message || (e.captured ? 'Read ' + e.captured : '') });
                TM.finishRun(r);
                if (e.captured) TM.toast((TM.cur && TM.cur.capture && TM.cur.capture.label || 'Result') + ': ' + e.captured, 'ok');
            } else {
                r.state = e.state; r.message = e.message;
                if (e.i != null) r.i = e.i;
                r.waiting = e.state === 'pause' || e.state === 'help';
                if (e.state !== 'step') r.log.push({ at: now(), state: e.state, message: e.message });
            }
            if (TM.cur && TM.cur.id === r.lessonId && TM.tab === 'run') { if (r.ended || e.state === 'pause' || e.state === 'help' || e.state === 'ready') TM.paintMain(); else TM.paintLive(); }
        }
    };

    // ── start address with {{variables}} (e.g. {{fusion_url}}) ──
    TM.startOf = function (l, vals) {
        var v = Object.assign({}, vals || {});
        (l.vars || []).forEach(function (x) { if (!String(v[x.name] || '').trim() && x.def) v[x.name] = x.def; });
        return TM.resolve(l.startUrl || '', v).trim();
    };

    // ── Ask AI: build a whole lesson (e.g. an Oracle Fusion setup) ──
    TM.FUSION = { PROD: 'https://efmh.fa.em3.oraclecloud.com', TEST: 'https://efmh-test.fa.em3.oraclecloud.com' };
    TM.fusionUrl = function (inst) { return lsGet('teachme.fusion.' + inst, TM.FUSION[inst] || ''); };
    TM.aiBanner = function (l) {
        if (!l.ai) return '';
        var a = l.ai, li = function (x) { return '<li>' + esc(x) + '</li>'; };
        return '<div class="banner warn" style="align-items:flex-start"><i class="fa-solid fa-wand-magic-sparkles" style="margin-top:3px"></i><div class="grow"><b>Built by AI' + (a.at ? ' on ' + esc(a.at.replace('T', ' ').slice(0, 16)) : '') + '</b> from ' + esc(a.source || 'its own knowledge') +
            '. The steps are written from that source, not recorded — the first run shows whether every field is found. A step that is not found: do it by hand, press Continue, then fix or re-record that step.' +
            (a.checks && a.checks.length ? '<div style="margin-top:6px"><b>Check on the first run</b><ul style="margin:2px 0 0 18px;padding:0">' + a.checks.map(li).join('') + '</ul></div>' : '') +
            (a.assumptions && a.assumptions.length ? '<details style="margin-top:6px"><summary>What the AI assumed (' + a.assumptions.length + ')</summary><ul style="margin:2px 0 0 18px;padding:0">' + a.assumptions.map(li).join('') + '</ul></details>' : '') +
            '</div><button class="btn sm" id="ai-ok" title="Hide this note once the lesson has run well">Checked ✓</button></div>';
    };
    document.addEventListener('click', function (e) { if (e.target && e.target.id === 'ai-ok' && TM.cur && TM.cur.ai) { TM.cur.ai.checked = true; delete TM.cur.ai; TM.touch(); TM.paintMain(); } });

    TM.aiForm = null;
    TM.askAi = function () {
        var f = TM.aiForm = TM.aiForm || { name: '', subject: 'Oracle Fusion setups', inst: lsGet('teachme.inst', 'TEST'), source: '', sourceUrl: '', extra: '', askFirst: true, fileName: '' };
        var insts = ['PROD', 'TEST', 'OTHER'];
        TM.modal('<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent)"></i> Ask AI to build a script',
            '<div class="form">' +
            '<label class="wide">Script name — what should it do?<input type="text" id="ai-name" value="' + esc(f.name) + '" placeholder="e.g. Create a new business unit" list="ai-ideas"></label>' +
            '<datalist id="ai-ideas">' + ['Create a new business unit', 'Create a legal entity', 'Create an inventory organization', 'Create a subinventory', 'Create a location', 'Create payment terms', 'Create a lookup code', 'Set a profile option value', 'Create a customer account', 'Create a supplier', 'Assign a data access set', 'Create an item', 'Open an inventory period', 'Create a price list']
                .map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
            '<label>Subject<input type="text" id="ai-subj" value="' + esc(f.subject) + '"></label>' +
            '<label>Instance<select id="ai-inst">' + insts.map(function (i) { return '<option' + (i === f.inst ? ' selected' : '') + '>' + i + '</option>'; }).join('') + '</select></label>' +
            '<label class="wide">Fusion address of this instance<input type="url" id="ai-url" value="' + esc(TM.fusionUrl(f.inst)) + '" placeholder="https://xxxx.fa.em3.oraclecloud.com"></label>' +
            '<label class="wide">Source — paste Oracle\'s documentation or type the steps the way you do it<textarea id="ai-src" rows="8" placeholder="e.g. the Oracle Help Center page for Manage Business Units, an implementation guide, your own notes: Setup and Maintenance > Manage Business Unit > Create …">' + esc(f.source) + '</textarea></label>' +
            '<label class="wide">…or a source address (https) the app reads<input type="url" id="ai-srcurl" value="' + esc(f.sourceUrl) + '" placeholder="https://docs.oracle.com/…"></label>' +
            '<div class="wide row"><label class="btn sm" style="cursor:pointer"><i class="fa-regular fa-file-lines"></i> Load a text file<input type="file" id="ai-file" accept=".txt,.md,.html,.htm,.csv,.json,.xml" hidden></label><span class="muted sm" id="ai-fname">' + esc(f.fileName ? 'Loaded: ' + f.fileName : 'txt, md, html, csv — for a PDF or Word file copy its text in') + '</span></div>' +
            '<label class="wide">Anything else (your company\'s rules, default values, what to leave out)<textarea id="ai-extra" rows="2">' + esc(f.extra) + '</textarea></label>' +
            '<label class="wide" style="flex-direction:row;align-items:center;gap:8px;text-transform:none;font-weight:600"><input type="checkbox" id="ai-ask"' + (f.askFirst ? ' checked' : '') + '> Ask me first when something it needs is missing</label>' +
            '</div><p class="muted sm" style="margin:8px 0 0">The AI writes the notes, the values it will ask for at every run (business unit name, legal entity …) and the clicks. It stops before Save and Close — you check and press it. Your Fusion user and password are never sent.</p>',
            [['Cancel', ''], ['<i class="fa-solid fa-wand-magic-sparkles"></i> Build the script', 'ok', 'primary']]).then(function (r) {
                if (r.button !== 'ok') return;
                TM.aiBuild();
            });
        var keep = function () {
            f.name = $('ai-name').value.trim(); f.subject = $('ai-subj').value.trim(); f.source = $('ai-src').value; f.sourceUrl = $('ai-srcurl').value.trim();
            f.extra = $('ai-extra').value; f.askFirst = $('ai-ask').checked; f.url = $('ai-url').value.trim();
        };
        ['ai-name', 'ai-subj', 'ai-src', 'ai-srcurl', 'ai-extra', 'ai-url'].forEach(function (id) { $(id).addEventListener('input', keep); });
        $('ai-ask').onchange = keep;
        $('ai-inst').onchange = function () { f.inst = this.value; lsSet('teachme.inst', f.inst); $('ai-url').value = TM.fusionUrl(f.inst); keep(); };
        $('ai-file').onchange = function () {
            var file = this.files && this.files[0]; if (!file) return;
            if (file.size > 3 * 1024 * 1024) { TM.toast('That file is too big — copy the part you need.', 'err'); return; }
            var rd = new FileReader();
            rd.onload = function () {
                var t = String(rd.result || '');
                if (/\.html?$/i.test(file.name)) { var d = new DOMParser().parseFromString(t, 'text/html'); d.querySelectorAll('script,style').forEach(function (x) { x.remove(); }); t = d.body ? d.body.innerText || d.body.textContent : t; }
                $('ai-src').value = ($('ai-src').value.trim() ? $('ai-src').value + '\n\n' : '') + t.trim(); f.fileName = file.name; $('ai-fname').textContent = 'Loaded: ' + file.name + ' (' + t.length.toLocaleString() + ' characters)'; keep();
            };
            rd.readAsText(file);
        };
        keep();
    };
    TM.aiBuild = function (answers) {
        var f = TM.aiForm;
        if (!f.name) { TM.toast('Give the script a name.', 'err'); return TM.askAi(); }
        if (!/^https:\/\//i.test(f.url || '')) { TM.toast('The Fusion address must begin with https://', 'err'); return TM.askAi(); }
        if (f.inst !== 'OTHER') lsSet('teachme.fusion.' + f.inst, f.url);
        f.answers = answers || f.answers || [];
        $('main').innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-wand-magic-sparkles fa-beat-fade"></i><b>Building “' + esc(f.name) + '”…</b><br><span class="sm">Claude is reading ' +
            (f.sourceUrl ? 'the source address' : f.source.trim() ? 'your source (' + f.source.length.toLocaleString() + ' characters)' : 'its own knowledge of Oracle Fusion') + ' and writing the notes, values and clicks. This takes up to a minute.</span></div></div>';
        var other = ['PROD', 'TEST'].filter(function (i) { return i !== f.inst; }).map(function (i) { return i + ' = ' + TM.fusionUrl(i); }).join(', ');
        return hostOk('teachAiBuild', { name: f.name, subject: f.subject, instance: f.inst, baseUrl: f.url, source: f.source, sourceUrl: f.sourceUrl,
                                        extra: (f.extra || '') + (other ? '\nOther instances: ' + other : ''), answers: f.answers, askFirst: f.askFirst && !answers })
            .then(function (d) {
                var res = d.result || {}, qs = (res.questions || []).filter(function (q) { return q && q.question; });
                if (!res.lesson && qs.length) return TM.aiQuestions(qs, d);
                if (!res.lesson) throw 'Claude did not return a lesson.';
                TM.aiCreate(res, d);
            })
            .catch(function (e) { TM.paintMain(); TM.toast(String(e), 'err'); });
    };
    TM.aiQuestions = function (qs, d) {
        TM.paintMain();
        return TM.modal('<i class="fa-solid fa-circle-question" style="color:var(--accent)"></i> The AI needs to know', '<p class="muted sm">Answer what you can — leave a box empty to let it assume.</p><div class="form">' + qs.slice(0, 5).map(function (q, i) {
            var opts = String(q.options || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
            return '<label class="wide" style="text-transform:none">' + esc(q.question) + (opts.length ? '<select data-q="' + i + '"><option value=""></option>' + opts.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select>' : '<input type="text" data-q="' + i + '">') + '</label>';
        }).join('') + '</div>' + (d.cost ? '<p class="muted sm">Cost so far $' + (+d.cost).toFixed(4) + '</p>' : ''), [['Cancel', ''], ['Build with these answers', 'ok', 'primary']]).then(function (r) {
            if (r.button !== 'ok') return;
            var ans = [];
            r.box.querySelectorAll('[data-q]').forEach(function (x) { ans.push({ question: qs[+x.dataset.q].question, answer: x.value.trim() || '(not known — assume)' }); });
            TM.aiBuild(ans);
        });
    };
    TM.aiCreate = function (res, d) {
        var f = TM.aiForm, src = res.lesson, l = TM.blank('navigation'), str = function (x, n) { return x == null ? '' : String(x).slice(0, n || 4000); };
        l.title = str(src.title, 300) || f.name;
        l.subject = str(src.subject, 200) || f.subject || 'Oracle Fusion setups';
        l.tags = str(src.tags, 300);
        l.notes = str(src.notes, 40000);
        l.startUrl = str(src.startUrl, 500) || '{{fusion_url}}/fscmUI/faces/FuseWelcome';
        var names = {};
        l.vars = (Array.isArray(src.vars) ? src.vars : []).filter(function (v) { return v && /^[A-Za-z_]\w{0,40}$/.test(v.name || '') && !names[v.name] && (names[v.name] = 1) && !/pass(word)?|pwd|secret/i.test(v.name); }).slice(0, 40).map(function (v) {
            return { name: v.name, label: str(v.label, 120) || v.name, hint: str(v.hint, 500), options: str(v.options, 2000), def: str(v.def, 2000), ai: v.ai !== false, long: !!v.long, required: !!v.required };
        });
        var fu = l.vars.filter(function (v) { return v.name === 'fusion_url'; })[0];
        if (!fu) { fu = { name: 'fusion_url', label: 'Fusion instance', ai: false }; l.vars.unshift(fu); }
        fu.ai = false; fu.def = fu.def && /^https:\/\//i.test(fu.def) ? fu.def : f.url;
        fu.options = Array.from(new Set([f.url].concat(['PROD', 'TEST'].map(TM.fusionUrl)).filter(Boolean))).join(',');
        fu.hint = fu.hint || 'PROD or TEST — the address the script opens';
        if (!/^https:\/\//i.test(TM.startOf(l))) l.startUrl = '{{fusion_url}}/fscmUI/faces/FuseWelcome';
        var OPS = { click: 1, fill: 1, select: 1, check: 1, key: 1, pause: 1, upload: 1 };
        l.steps = (Array.isArray(src.steps) ? src.steps : []).filter(function (s) { return s && OPS[s.op]; }).slice(0, 120).map(function (s) {
            var t = s.t || {}, o = { op: s.op, ai: true };
            if (s.op !== 'pause') { o.t = {}; ['tag', 'label', 'text', 'role', 'placeholder', 'name'].forEach(function (k) { if (t[k]) o.t[k] = str(t[k], 300); }); }
            if (s.value != null && s.value !== '') o.value = str(s.value, 4000);
            if (s.optText) o.optText = str(s.optText, 300);
            if (s.note) o.note = str(s.note, 500);
            if (s.optional) o.optional = true;
            if (s.stop) o.stop = true;
            if (+s.timeout) o.timeout = Math.max(1000, Math.min(120000, +s.timeout));
            if (o.op === 'click' && o.t && /^\s*(save|save and close|save and submit|submit|submit for approval)\s*$/i.test(o.t.text || o.t.label || '')) o.stop = true;
            return o;
        }).filter(function (s) { return s.op === 'pause' || (s.t && (s.t.label || s.t.text || s.t.placeholder || s.t.name)); });
        // never press past the first ✋: everything after it is dropped (one script = one record)
        var firstStop = -1; l.steps.forEach(function (s, i) { if (s.stop && firstStop < 0) firstStop = i; });
        if (firstStop >= 0) l.steps = l.steps.slice(0, firstStop + 1);
        if (src.capture && src.capture.regex) { try { new RegExp(src.capture.regex); l.capture = { regex: str(src.capture.regex, 300), label: str(src.capture.label, 80) }; } catch (e) { } }
        l.ai = { at: now(), by: TM.user, name: f.name, instance: f.inst, source: f.sourceUrl ? f.sourceUrl : f.source.trim() ? (f.fileName || 'the text you gave') + ' (' + f.source.length.toLocaleString() + ' characters)' : 'its own knowledge (no source given)',
                 assumptions: (res.assumptions || []).map(function (x) { return str(x, 400); }).slice(0, 20), checks: (res.checks || []).map(function (x) { return str(x, 400); }).slice(0, 20), cost: d.cost || 0 };
        TM.cur = l; TM.tab = 'lesson'; TM.subject = l.subject; lsSet('teachme.cur', l.id);
        TM.save(true).then(function () {
            TM.paintTree(); TM.paintMain();
            TM.toast('“' + l.title + '” built: ' + l.steps.length + ' steps, ' + l.vars.length + ' values — saved in APEX and on this PC' + (d.cost ? ' · $' + (+d.cost).toFixed(4) : '') + '.', 'ok');
        });
        TM.aiForm = Object.assign({}, f, { name: '', source: '', sourceUrl: '', extra: '', fileName: '', answers: [] });
    };

    // ── start ───────────────────────────────────────────────────
    $('who').textContent = TM.user;
    $('q').oninput = TM.paintTree;
    $('new').onclick = function (e) { e.stopPropagation(); $('newmenu').hidden = !$('newmenu').hidden; };
    document.addEventListener('click', function () { $('newmenu').hidden = true; });
    $('newmenu').querySelectorAll('[data-new]').forEach(function (b) { b.onclick = function () { $('newmenu').hidden = true; if (b.dataset.new === 'ai') TM.askAi(); else TM.create(b.dataset.new); }; });
    $('modal').addEventListener('mousedown', function (e) { if (e.target === $('modal')) $('modal').hidden = true; });
    document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 's' && TM.cur) { e.preventDefault(); TM.save(); } });
    window.addEventListener('beforeunload', function (e) { if (TM.dirty) { e.preventDefault(); e.returnValue = ''; } });
    TM.paintStore(); TM.paintTree(); TM.paintMain();
    if (TM.hasHost()) TM.load().catch(function (e) { TM.toast(String(e), 'err'); });
    else TM.toast('Open this page inside the Gray\'s WMS app — lessons are saved through it.', 'err');
})();

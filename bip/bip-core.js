/* Oracle BIP Reporting · the page (window.BIP). Tabs: Catalog (browse / search the BI Publisher catalog — from this PC's DuckDB
 * copy, Fusion on Refresh — favourites, popular), Run (the parameter form of a report, the output formats of its definition,
 * date / value buckets, progress, the result as the page's own grid / pivot / chart / summary, the SQL of the data model),
 * Dashboards (cards of reports kept in APEX, every card runs with the report's own data format and opens on its last kept
 * result), Explore (read-only SQL over the DuckDB file: results, catalog, runs), History, Settings.
 * Engine: bip-engine.js (BIPE), grid + pivot: bip-grid.js (BIPG), host + APEX: bip-store.js (BIPS). */
(function () {
    'use strict';
    var E = window.BIPE, S = window.BIPS, G = window.BIPG;
    var $ = function (id) { return document.getElementById(id); };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function ls(k, d) { try { var v = localStorage.getItem('bip.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem('bip.' + k, JSON.stringify(v)); } catch (e) { } }
    function toast(msg, kind, ms) { var t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); } t.className = 'toast ' + (kind || ''); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.style.display = 'none'; }, ms || (kind === 'bad' ? 8000 : 2500)); }
    /** The working indicator is a chip in the header toolbar (#busy, right of the title): spinner + what is going on. */
    function busy(label) { P.busyN++; var b = $('busy'); if (!b) { b = document.createElement('span'); b.id = 'busy'; b.className = 'hb'; var who = $('who'); if (who && who.parentNode) who.parentNode.insertBefore(b, who); else document.body.appendChild(b); } b.innerHTML = '<span class="spin"></span><span class="lbl">' + esc(label || 'Working…') + '</span>'; b.style.display = 'inline-flex'; b.title = label || ''; return function () { P.busyN = Math.max(0, P.busyN - 1); if (!P.busyN && $('busy')) $('busy').style.display = 'none'; }; }
    function run(label, p) { var done = busy(label); function step(l) { var b = $('busy'); if (b && b.lastChild) { b.lastChild.textContent = l; b.title = l; } } return Promise.resolve().then(function () { return p(step); }).then(function (r) { done(); return r; }, function (e) { done(); toast(String(e && e.message || e), 'bad'); throw e; }); }
    function fmt(d) { return d ? String(d).replace('T', ' ').slice(0, 16) : ''; }
    function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function nameOf(path) { return String(path || '').split('/').pop().replace(/\.(xdo|xdm)$/i, ''); }

    var P = window.BIP = {
        tab: ls('tab', 'catalog'), pod: ls('pod', '') || S.loginPod(), status: null, busyN: 0,
        cat: { path: '/', items: [], cache: {}, q: '', at: '' }, index: { items: null, at: null, folders: 0, reports: 0 }, indexing: null,
        favs: [], notes: {}, popular: [], recent: [],
        rep: null, running: null, result: null, resView: ls('resView', 'grid'), chart: ls('chart', { type: 'bar', fn: 'sum', top: 20 }),
        dashes: [], dash: null, dashRes: {}, dashBusy: {}, dashTimer: null,
        runs: [], log: [],
        explore: { sql: ls('explore.sql', ''), res: null, tables: [], duck: null, busy: false },
        set: Object.assign({ chunkMb: 8, timeoutMin: 20, rowsAtOnce: 20000, indexRoot: '/', dateDefaultDays: 30 }, ls('set', {}))
    };

    // ── boot ──────────────────────────────────────────────────────
    function boot() {
        paintWho();
        document.querySelectorAll('#tabs button').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.tab); }); });
        document.addEventListener('click', onClick);
        document.addEventListener('change', onChange);
        document.addEventListener('input', onInput);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target && e.target.id === 'ex-sql') { e.preventDefault(); runExplore(); } });
        if (!S.hasHost()) { render(); $('main').innerHTML = '<div class="card warnbox">Open this page inside the Gray\'s WMS app — the BI Publisher calls run in the desktop host with the application\'s Fusion credentials.</div>'; return; }
        go(P.tab);   // draws the tab that was open last and starts its loader (dashboards, history, explore)
        S.bip('bipStatus', { instance: P.pod }).then(function (st) { P.status = st; if (st.index) { P.index.at = st.index.at; P.index.folders = st.index.folders; P.index.reports = st.index.reports; } paintWho(); if (P.tab === 'catalog') render(); }).catch(function (e) { toast(e.message, 'bad'); });
        loadShared();
        if (P.tab === 'catalog') loadFolder(P.cat.path);
        var m = /[#&]run=([^&]+)/.exec(location.hash); if (m) openReport(decodeURIComponent(m[1]));
    }
    function paintWho() {
        var st = P.status || {};
        $('who').innerHTML = esc(S.user()) + (st.user ? ' · Fusion user ' + esc(st.user) : '') + '<span class="pod ' + (P.pod === 'TEST' ? 'test' : '') + '" data-act="pod" title="Switch the pod">' + esc(P.pod) + ' ▾</span>';
    }
    function loadShared() {
        S.fav.list(P.pod).then(function (f) { P.favs = f; if (P.tab === 'catalog') render(); }).catch(function () { });
        S.runLog.popular(P.pod, 90).then(function (p) { P.popular = p; if (P.tab === 'catalog') render(); }).catch(function () { });
        S.runLog.recent(P.pod, 15).then(function (r) { P.recent = r; if (P.tab === 'catalog') render(); }).catch(function () { });
        S.notes.all(P.pod).then(function (n) { P.notes = {}; n.forEach(function (x) { P.notes[x.P] = x; }); }).catch(function () { });
    }
    function go(tab) { P.tab = tab; lsSet('tab', tab); document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); }); render(); if (tab === 'history') loadRuns(); if (tab === 'dash') loadDashes(); if (tab === 'explore') loadTables(); }
    function render() {
        var m = $('main'); if (!m) return;
        if (window.Chart) Object.keys(charts).forEach(function (k) { try { charts[k].destroy(); } catch (e) { } delete charts[k]; });
        m.innerHTML = P.tab === 'catalog' ? vCatalog() : P.tab === 'run' ? vRun() : P.tab === 'dash' ? vDash() : P.tab === 'explore' ? vExplore() : P.tab === 'history' ? vHistory() : vSettings();
        if (P.tab === 'run') afterRun();
        if (P.tab === 'dash') afterDash();
        if (P.tab === 'explore') afterExplore();
    }
    var charts = {};

    // ── Catalog ───────────────────────────────────────────────────
    function loadFolder(path, refresh) {
        path = path || '/';
        if (!refresh && P.cat.cache[path]) { var c = P.cat.cache[path]; P.cat.path = path; P.cat.items = c.items; P.cat.at = c.at; P.cat.src = c.src; P.cat.kept = c.kept; render(); return Promise.resolve(); }
        var pod = P.pod;
        return run((refresh ? 'Reading ' + path + ' from Fusion…' : 'Opening ' + path + '…'), function (step) {
            if (refresh) return S.bip('bipCatalog', { instance: pod, path: path, refresh: true }).then(function (d) { S.catalog.saveFolder(pod, path, d.items || []).catch(function (e) { console.warn('[BIP] catalog → APEX', e.message); }); return d; });
            return S.bip('bipCatalog', { instance: pod, path: path, local: true }).then(function (d) {
                if (d.src === 'duckdb') return d;
                step('Looking in APEX for ' + path + '…');
                return S.catalog.folder(pod, path).then(function (a) {
                    if (a && a.items && a.items.length) { S.bip('bipCatalogKeep', { instance: pod, path: path, items: a.items }).catch(function () { }); return { ok: true, path: path, items: a.items, src: 'apex', at: a.at, by: a.by }; }
                    step('Reading ' + path + ' from Fusion…');
                    return S.bip('bipCatalog', { instance: pod, path: path }).then(function (f) { S.catalog.saveFolder(pod, path, f.items || []).catch(function (e) { console.warn('[BIP] catalog → APEX', e.message); }); return f; });
                }, function () { step('Reading ' + path + ' from Fusion…'); return S.bip('bipCatalog', { instance: pod, path: path }); });
            });
        }).then(function (d) {
            if (P.pod !== pod) return;
            P.cat.path = d.path || path; P.cat.items = d.items || []; P.cat.at = d.at; P.cat.src = d.src || 'fusion'; P.cat.kept = d.kept !== false; P.cat.by = d.by;
            P.cat.cache[P.cat.path] = { items: P.cat.items, at: d.at, src: P.cat.src, kept: P.cat.kept, by: d.by };
            lsSet('catPath', P.cat.path); render();
        }).catch(function () { render(); });
    }
    function crumbs(path) {
        var parts = String(path || '/').split('/').filter(Boolean), h = '<a data-act="cd" data-path="/"><i class="fas fa-house"></i></a>', acc = '';
        parts.forEach(function (p) { acc += '/' + p; h += '<span class="sep">/</span><a data-act="cd" data-path="' + esc(acc) + '">' + esc(p) + '</a>'; });
        return '<div class="crumbs">' + h + '</div>';
    }
    function icon(it) { var t = String(it.type || ''); return t === 'Folder' ? '<span class="ic folder"><i class="fas fa-folder"></i></span>' : t === 'Report' ? '<span class="ic report"><i class="fas fa-file-lines"></i></span>' : /DataModel/i.test(t) ? '<span class="ic dm"><i class="fas fa-database"></i></span>' : '<span class="ic other"><i class="fas fa-file"></i></span>'; }
    function isFav(path) { return P.favs.some(function (f) { return f.P === path; }); }
    function itemRow(it, showPath) {
        var isRep = it.type === 'Report', isDm = /DataModel/i.test(it.type || ''), isF = it.type === 'Folder';
        var note = P.notes[it.absolutePath];
        return '<div class="it"><div>' + icon(it) + '</div><div style="flex:1;min-width:0"><div class="nm" data-act="' + (isF ? 'cd' : isRep ? 'open' : isDm ? 'sql' : 'none') + '" data-path="' + esc(it.absolutePath) + '">' + esc(it.displayName || it.fileName) + (note && note.T ? ' <span class="pill info">' + esc(note.T) + '</span>' : '') + '</div>' +
            (showPath || !isF ? '<div class="pth">' + esc(it.absolutePath) + '</div>' : '') + '</div>' +
            '<div class="meta">' + esc(it.type || '') + (it.lastModified ? ' · ' + esc(fmt(it.lastModified)) : '') + (it.owner ? ' · ' + esc(it.owner) : '') + '</div>' +
            '<div class="acts">' + (isRep ? '<span class="star ' + (isFav(it.absolutePath) ? 'on' : '') + '" data-act="fav" data-path="' + esc(it.absolutePath) + '" data-name="' + esc(it.displayName || '') + '" title="Favourite"><i class="fas fa-star"></i></span>' +
            '<button class="btn sm pri" data-act="open" data-path="' + esc(it.absolutePath) + '"><i class="fas fa-play"></i> Open</button><button class="btn sm" data-act="addCard" data-path="' + esc(it.absolutePath) + '" data-name="' + esc(it.displayName || '') + '" title="Add to a dashboard"><i class="fas fa-plus"></i></button>' : isDm ? '<button class="btn sm" data-act="sql" data-path="' + esc(it.absolutePath) + '"><i class="fas fa-code"></i> SQL</button>' : isF ? '<button class="btn sm" data-act="cd" data-path="' + esc(it.absolutePath) + '">Open</button>' : '') + '</div></div>';
    }
    function vCatalog() {
        var h = '';
        var q = P.cat.q.trim();
        h += '<div class="card"><div class="row"><input type="search" id="cat-q" placeholder="Find a report — in this folder, or the whole catalog once it is indexed" value="' + esc(P.cat.q) + '" style="flex:1;min-width:260px">' +
            '<button class="btn" data-act="index" title="Walk the whole catalog once (every folder, breadth-first) so the search box finds any report by name; kept on this PC and shared through APEX">' + (P.indexing ? '<i class="fas fa-spinner fa-spin"></i> Indexing… ' + esc(P.indexing) : P.index.at ? '<i class="fas fa-rotate"></i> Re-index (' + P.index.reports + ' reports, ' + esc(P.index.at) + (P.index.src === 'apex' ? ' · shared by ' + esc(P.index.by || 'another user') : '') + ')' : '<i class="fas fa-magnifying-glass-plus"></i> Index the catalog for search') + '</button>' + (P.indexing ? '<button class="btn sm" data-act="indexCancel">Stop</button>' : '') + '<a data-act="indexHelp" class="muted small" style="cursor:pointer" title="How the index works"><i class="fas fa-circle-question"></i></a>' +
            '<button class="btn" data-act="refreshFolder" title="Read this folder again from Fusion"><i class="fas fa-rotate"></i></button></div></div>';
        if (q) {
            var pool = P.index.items || [];
            var hits = E.search(pool, q, 80);
            var local = P.cat.items.filter(function (it) { return q.toLowerCase().split(/\s+/).every(function (w) { return String(it.displayName || it.fileName || '').toLowerCase().indexOf(w) >= 0; }); });
            h += '<div class="card"><h2>In ' + esc(P.cat.path) + ' <span class="pill">' + local.length + '</span></h2><div class="items">' + (local.length ? local.map(function (it) { return itemRow(it, false); }).join('') : '<div class="empty">Nothing here matches</div>') + '</div></div>';
            h += '<div class="card"><h2>Whole catalog <span class="pill">' + (P.index.items ? hits.length : 'not indexed') + '</span></h2>' + (P.index.items ? '<div class="items">' + (hits.length ? hits.map(function (it) { return itemRow(it, true); }).join('') : '<div class="empty">No report of the ' + P.index.reports + ' indexed matches — <a data-act="index" style="color:var(--pri);cursor:pointer">index again</a> if the catalog changed</div>') + '</div>' : '<div class="muted small">Index the catalog once (button above) and this box finds any report by name, wherever it sits.</div>') + '</div>';
            return h;
        }
        // start here
        h += '<div class="start">';
        h += '<div class="card"><h2><i class="fas fa-star" style="color:var(--amber)"></i> Favourites</h2><div class="lst">' + (P.favs.length ? P.favs.map(function (f) { return '<a data-act="open" data-path="' + esc(f.P) + '">' + esc(f.N || nameOf(f.P)) + '<span class="s">' + esc(f.P) + '</span></a>'; }).join('') : '<div class="muted small">Star a report and it lands here.</div>') + '</div></div>';
        h += '<div class="card"><h2><i class="fas fa-fire" style="color:var(--acc)"></i> Popular on ' + esc(P.pod) + '</h2><div class="lst">' + (P.popular.length ? P.popular.slice(0, 8).map(function (p) { return '<a data-act="open" data-path="' + esc(p.P) + '">' + esc(p.N || nameOf(p.P)) + '<span class="s">' + esc(p.RUNS) + ' runs · ' + esc(p.USERS) + ' people · ~' + esc(E.fmtMs(p.AVG_MS)) + '</span></a>'; }).join('') : '<div class="muted small">Runs from every PC show up here (last 90 days).</div>') + '</div></div>';
        h += '<div class="card"><h2><i class="fas fa-clock-rotate-left"></i> Recent runs</h2><div class="lst">' + (P.recent.length ? P.recent.slice(0, 8).map(function (r) { return '<a data-act="open" data-path="' + esc(r.P) + '">' + esc(r.N || nameOf(r.P)) + '<span class="s">' + esc(r.U) + ' · ' + esc(r.AT) + ' · ' + esc(E.fmtNum(r.ROWS_N)) + ' rows · ' + esc(r.S) + '</span></a>'; }).join('') : '<div class="muted small">Nothing run yet.</div>') + '</div></div>';
        h += '</div>';
        var folders = P.cat.items.filter(function (i) { return i.type === 'Folder'; }), files = P.cat.items.filter(function (i) { return i.type !== 'Folder'; });
        h += '<div class="cat"><div class="card"><h2>Folders</h2>' + crumbs(P.cat.path) + '<div class="tree" style="margin-top:8px">' + (P.cat.path !== '/' ? '<a data-act="cd" data-path="' + esc(parentOf(P.cat.path)) + '"><span class="ic"><i class="fas fa-turn-up"></i></span> ..</a>' : '') +
            (folders.length ? folders.map(function (f) { return '<a data-act="cd" data-path="' + esc(f.absolutePath) + '"><span class="ic"><i class="fas fa-folder"></i></span> ' + esc(f.displayName || f.fileName) + '</a>'; }).join('') : '<div class="muted small" style="padding:6px 8px">No sub-folders</div>') + '</div>' +
            (P.cat.path === '/' ? '<div class="muted small" style="margin-top:8px">Fusion keeps custom reports under <a data-act="cd" data-path="/Custom" style="color:var(--pri);cursor:pointer">/Custom</a> and Oracle\'s own under Shared Folders.</div>' : '') + '</div>';
        h += '<div class="card"><h2>' + esc(P.cat.path) + ' <span class="pill">' + files.length + ' items</span> ' + srcNote(P.cat.src, P.cat.at, P.cat.kept, 'refreshFolder', P.cat.by) + '</h2><div class="items">' + (files.length ? files.map(function (it) { return itemRow(it, false); }).join('') : '<div class="empty">' + (P.cat.items.length ? 'Only folders here' : 'Empty, or not read yet') + '</div>') + '</div></div></div>';
        return h;
    }
    /** Where a thing came from: this PC's DuckDB copy (read at …) with a Refresh link, or Fusion just now (kept in DuckDB). */
    function srcNote(src, at, kept, act, by) {
        if (!src) return '';
        var duck = src === 'duckdb', apex = src === 'apex';
        var title = duck ? 'As kept in this PC\'s DuckDB file; Refresh asks Fusion again' : apex ? 'Shared through APEX by another user; now kept on this PC too' : 'Read from the Fusion pod just now, kept on this PC and shared through APEX';
        var text = duck ? 'from DuckDB · read ' + esc(at || '') : apex ? 'from APEX · read ' + esc(at || '') + (by ? ' by ' + esc(by) : '') : 'from Fusion ' + esc(at || '') + (kept === false ? ' · <b>not kept</b>' : ' · kept + shared');
        return '<span class="src ' + (duck ? 'duck' : apex ? 'apex' : 'live') + '" title="' + title + '"><i class="fas ' + (duck ? 'fa-database' : apex ? 'fa-people-group' : 'fa-cloud') + '"></i> ' + text + (act ? ' · <a data-act="' + act + '" title="Read it again from Fusion">Refresh</a>' : '') + '</span>';
    }
    function parentOf(p) { var i = String(p).replace(/\/$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
    function indexCatalog() {
        if (P.indexing) return;
        P.indexing = 'starting'; render();
        S.bip('bipIndex', { instance: P.pod, root: P.set.indexRoot || '/', max: 1500 }, 0, function (pr) { P.indexing = pr.folders + ' folders · ' + esc(String(pr.path || '').slice(-40)); var b = document.querySelector('[data-act=index]'); if (b) b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Indexing… ' + P.indexing; })
            .then(function (d) {
                P.index = { items: d.items || [], at: d.at, folders: d.folders, reports: d.reports, src: 'fusion' }; P.indexing = null; toast('Indexed ' + d.reports + ' reports in ' + d.folders + ' folders (' + E.fmtMs(d.ms) + ') — kept on this PC, sharing through APEX…', 'ok', 5000); render();
                var pod = P.pod; S.catalog.saveIndex(pod, P.set.indexRoot || '/', d.items || [], d.folders, d.reports, d.ms).then(function () { if (P.pod === pod) { P.index.shared = true; toast('The catalog of ' + pod + ' is shared through APEX — other users get it at once', 'ok', 4000); } }).catch(function (e) { toast('Catalog kept on this PC, but not shared through APEX: ' + e.message, 'warn', 8000); });
            })
            .catch(function (e) { P.indexing = null; toast(e.message, 'bad'); render(); });
    }
    /** The catalog index for the search box: this PC's DuckDB copy, else the copy another user shared through APEX (then kept here), else nothing until Index runs. */
    function ensureIndex() {
        if (P.index.items) return Promise.resolve();
        var pod = P.pod;
        return S.bip('bipIndexGet', { instance: pod }).then(function (d) {
            if (d.at && d.items && d.items.length) { P.index = { items: d.items, at: d.at, folders: d.folders || 0, reports: d.reports || 0, src: d.src || 'duckdb' }; return; }
            return S.catalog.index(pod).then(function (a) {
                if (!a || !a.items.length || P.pod !== pod) return;
                P.index = { items: a.items, at: a.at, folders: a.folders, reports: a.reports, src: 'apex', by: a.by };
                S.bip('bipCatalogKeep', { instance: pod, index: true, root: a.root || '/', items: a.items, folders: a.folders, reports: a.reports }).catch(function () { });
            }).catch(function () { });
        });
    }

    // ── Run ───────────────────────────────────────────────────────
    function openReport(path, preset, refresh) {
        go('run');
        P.rep = { path: path, name: nameOf(path), def: null, params: [], values: {}, format: 'xml', template: '', bucket: { mode: 'none', by: 'month', n: 7 }, loading: true, sql: null };
        render();
        return run((refresh ? 'Reading ' + P.rep.name + ' from Fusion…' : 'Opening ' + P.rep.name + '…'), function (step) {
            return Promise.all([S.bip('bipDefinition', { instance: P.pod, path: path, refresh: !!refresh }).catch(function (e) { return { def: null, error: e.message }; }), S.bip('bipParameters', { instance: P.pod, path: path, refresh: !!refresh }).catch(function (e) { return { prms: null, error: e.message }; })]);
        }).then(function (x) {
            var r = P.rep; if (!r || r.path !== path) return;
            r.def = x[0].def || null; r.defError = x[0].error; r.paramsError = x[1].error;
            r.src = x[0].src || x[1].src || 'fusion'; r.readAt = x[0].readAt || x[1].readAt || '';
            var prms = x[1].prms || (r.def && r.def.parameters) || [];
            if (r.def && r.def.parameters && r.def.parameters.length) {
                // the definition knows the date formats and LOV labels the parameter call may not
                var byName = {}; r.def.parameters.forEach(function (p) { byName[p.name] = p; });
                prms = prms.map(function (p) { var d = byName[p.name] || {}; return Object.assign({}, d, p, { lovLabels: (p.lovLabels && p.lovLabels.length ? p.lovLabels : d.lovLabels) || [], dateFormatString: p.dateFormatString || d.dateFormatString, defaultValue: p.defaultValue != null && p.defaultValue !== '' ? p.defaultValue : d.defaultValue }); });
                r.def.parameters.forEach(function (p) { if (!prms.some(function (x) { return x.name === p.name; })) prms.push(p); });
            }
            r.params = prms; r.name = (r.def && r.def.reportName) || r.name;
            r.values = {}; prms.forEach(function (p) { var k = E.kind(p); var dv = p.values && p.values.length && p.values[0] !== '' ? (p.multiValuesAllowed ? p.values : p.values[0]) : p.defaultValue; if (k === 'date') { var d = E.parse(dv, p.dateFormatString); r.values[p.name] = d ? E.iso(d) : ''; } else r.values[p.name] = dv == null ? '' : dv; });
            r.formats = formatsOf(r); r.format = E.defaultFormat(r.def, r.formats);
            r.template = r.def && r.def.defaultTemplateId || '';
            var pairs = E.datePairs(prms);
            if (pairs.length) { r.bucket.fromParam = pairs[0].from; r.bucket.toParam = pairs[0].to; var f = r.values[pairs[0].from], t = r.values[pairs[0].to]; if (!f || !t) { var today = new Date(); r.values[pairs[0].to] = r.values[pairs[0].to] || E.iso(today); r.values[pairs[0].from] = r.values[pairs[0].from] || E.iso(E.addDays(today, -(P.set.dateDefaultDays || 30))); } }
            var menus = prms.filter(function (p) { return E.kind(p) === 'menu'; }); if (menus.length) r.bucket.valueParam = menus[0].name;
            if (preset) applyPreset(preset);
            r.loading = false;
            lsSet('lastReport', path);
            S.notes.get(P.pod, path).then(function (n) { if (P.rep === r) { r.note = n; render(); } }).catch(function () { });
            render();
        });
    }
    function applyPreset(ps) {
        var r = P.rep; if (!r || !ps) return;
        if (ps.values) r.params.forEach(function (p) { if (ps.values[p.name] != null) { var v = ps.values[p.name]; r.values[p.name] = E.kind(p) === 'date' && typeof v === 'string' ? (E.iso(E.parse(v, p.dateFormatString)) || v) : v; } });
        if (ps.format && (r.formats || []).some(function (f) { return f.value === String(ps.format).toLowerCase(); })) r.format = String(ps.format).toLowerCase();
        if (ps.template) r.template = ps.template;
        if (ps.bucket) r.bucket = Object.assign({}, r.bucket, ps.bucket);
    }
    /** The output formats of the report definition (its templates' formats + XML data, which runReport always accepts). */
    function formatsOf(r) { return E.formats(r && r.def); }
    function fmtLabel(f) { return esc(f.label) + (f.value === 'csv' ? ' — data for the grid, pivot, charts' : f.value === 'xml' ? ' — data' + (f.always && !f.templates.length ? ' (always available)' : '') : f.templates.length > 1 ? '' : ''); }
    function paramControl(p) {
        var k = E.kind(p), v = P.rep.values[p.name], id = 'pv-' + p.name;
        var label = '<label>' + esc(p.label || p.name) + (p.label && p.label !== p.name ? '<span class="t">' + esc(p.name) + '</span>' : '') + '<span class="t">' + esc(k) + (p.dateFormatString ? ' · ' + esc(p.dateFormatString) : '') + (p.multiValuesAllowed ? ' · multi' : '') + '</span></label>';
        if (k === 'hidden') return '<div class="p">' + label + '<input type="text" class="pv" id="' + id + '" data-p="' + esc(p.name) + '" value="' + esc(v) + '" placeholder="(hidden parameter)"></div>';
        if (k === 'date') return '<div class="p">' + label + '<input type="date" class="pv" id="' + id + '" data-p="' + esc(p.name) + '" value="' + esc(v) + '"></div>';
        if (k === 'bool') return '<div class="p">' + label + '<label class="chk"><input type="checkbox" class="pv" id="' + id + '" data-p="' + esc(p.name) + '" ' + (v === true || v === 'true' || v === 'Y' ? 'checked' : '') + '> yes</label></div>';
        if (k === 'menu') {
            var opts = (p.lovLabels || []).slice();
            var cur = Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
            cur.forEach(function (c) { if (c !== '__ALL__' && opts.indexOf(c) < 0) opts.unshift(c); });
            var h = '<div class="p">' + label + '<select class="pv" id="' + id + '" data-p="' + esc(p.name) + '" ' + (p.multiValuesAllowed ? 'multiple' : '') + '>' + (p.multiValuesAllowed ? '' : '<option value="">(none)</option>') + (p.selectAsAll || p.multiValuesAllowed ? '<option value="__ALL__" ' + (cur.indexOf('__ALL__') >= 0 || (cur.indexOf('*') >= 0) ? 'selected' : '') + '>All</option>' : '') +
                opts.map(function (o) { return '<option value="' + esc(o) + '" ' + (cur.indexOf(o) >= 0 ? 'selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>' + (opts.length ? '<div class="muted small">' + opts.length + ' values from the report\'s list' + (p.multiValuesAllowed ? ' · Ctrl-click for several' : '') + '</div>' : '<div class="muted small">The list of values is empty here — type below</div><input type="text" class="pv2" data-p="' + esc(p.name) + '" placeholder="value' + (p.multiValuesAllowed ? 's, comma separated' : '') + '">') + '</div>';
            return h;
        }
        if (k === 'number') return '<div class="p">' + label + '<input type="number" class="pv" id="' + id + '" data-p="' + esc(p.name) + '" value="' + esc(v) + '"></div>';
        return '<div class="p">' + label + '<input type="text" class="pv" id="' + id + '" data-p="' + esc(p.name) + '" value="' + esc(Array.isArray(v) ? v.join(',') : v) + '" ' + (p.fieldSize ? 'maxlength="' + (+p.fieldSize * 4) + '"' : '') + '></div>';
    }
    function readForm() {
        var r = P.rep; if (!r) return;
        document.querySelectorAll('#params .pv').forEach(function (el) {
            var name = el.dataset.p, p = r.params.filter(function (x) { return x.name === name; })[0]; if (!p) return;
            if (el.type === 'checkbox') r.values[name] = el.checked;
            else if (el.tagName === 'SELECT' && el.multiple) r.values[name] = [].map.call(el.selectedOptions, function (o) { return o.value; });
            else r.values[name] = el.value;
        });
        document.querySelectorAll('#params .pv2').forEach(function (el) { if (el.value.trim()) { var p = r.params.filter(function (x) { return x.name === el.dataset.p; })[0]; r.values[el.dataset.p] = p && p.multiValuesAllowed ? el.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : el.value.trim(); } });
        var f = $('r-format'); if (f) r.format = f.value;
        var t = $('r-template'); if (t) r.template = t.value;
        var b = r.bucket;
        var el;
        if ((el = $('b-mode'))) b.mode = el.value;
        if ((el = $('b-from'))) b.fromParam = el.value; if ((el = $('b-to'))) b.toParam = el.value;
        if ((el = $('b-by'))) b.by = el.value; if ((el = $('b-n'))) b.n = +el.value || 1;
        if ((el = $('b-vparam'))) b.valueParam = el.value;
        if ((el = $('b-values'))) b.values = el.value.split(/\n|,/).map(function (s) { return s.trim(); }).filter(Boolean);
        if ((el = $('r-chunk'))) P.set.chunkMb = +el.value || 8; if ((el = $('r-timeout'))) P.set.timeoutMin = +el.value || 20;
        lsSet('set', P.set);
    }
    function planOf() {
        var r = P.rep, b = r.bucket, o = { params: r.params };
        if ((b.mode === 'date' || b.mode === 'both') && b.fromParam && b.toParam) o.dateBucket = { fromParam: b.fromParam, toParam: b.toParam, by: b.by, n: b.by === 'days' ? b.n : 1, from: r.values[b.fromParam], to: r.values[b.toParam] };
        if ((b.mode === 'value' || b.mode === 'both') && b.valueParam) { var vals = b.values && b.values.length ? b.values : lovOf(b.valueParam); o.valueBucket = { param: b.valueParam, values: vals }; }
        return E.plan(o);
    }
    function lovOf(name) { var p = (P.rep.params || []).filter(function (x) { return x.name === name; })[0]; return p && p.lovLabels || []; }
    function vRun() {
        var r = P.rep;
        if (!r) return '<div class="card empty">Pick a report in the Catalog' + (ls('lastReport') ? ' — or <a data-act="open" data-path="' + esc(ls('lastReport')) + '" style="color:var(--pri);cursor:pointer">reopen ' + esc(nameOf(ls('lastReport'))) + '</a>' : '') + '.</div>' + (P.result ? vResult() : '');
        var h = '<div class="card"><div class="row"><div><div style="font-weight:800;font-size:16px">' + esc(r.name) + ' <span class="star ' + (isFav(r.path) ? 'on' : '') + '" data-act="fav" data-path="' + esc(r.path) + '" data-name="' + esc(r.name) + '"><i class="fas fa-star"></i></span></div><div class="mono small muted">' + esc(r.path) + ' · ' + esc(P.pod) + '</div>' + (r.def && r.def.description ? '<div class="small muted" style="margin-top:4px">' + esc(r.def.description) + '</div>' : '') + '</div><span class="sp"></span>' +
            '<button class="btn" data-act="cd" data-path="' + esc(parentOf(r.path)) + '"><i class="fas fa-folder-open"></i> Folder</button><button class="btn" data-act="sql" data-path="' + esc(r.path) + '" title="The SQL of the data model behind this report"><i class="fas fa-code"></i> SQL behind it</button><button class="btn" data-act="notes" title="Notes and tags for everyone"><i class="fas fa-note-sticky"></i> Notes' + (r.note && r.note.N ? ' ●' : '') + '</button><button class="btn" data-act="addCard" data-path="' + esc(r.path) + '" data-name="' + esc(r.name) + '"><i class="fas fa-plus"></i> Add to a dashboard</button></div>' +
            (r.loading ? '' : '<div class="small" style="margin-top:6px">Definition and parameters ' + srcNote(r.src, r.readAt, true, 'refreshDef') + '</div>') +
            (r.defError ? '<div class="warnbox" style="margin-top:8px">Definition: ' + esc(r.defError) + '</div>' : '') + (r.paramsError ? '<div class="warnbox" style="margin-top:8px">Parameters: ' + esc(r.paramsError) + '</div>' : '') + '</div>';
        if (r.loading) return h + '<div class="card empty"><i class="fas fa-spinner fa-spin"></i> Reading the definition and parameters…</div>';
        var b = r.bucket, dates = r.params.filter(function (p) { return E.kind(p) === 'date'; }), menus = r.params.filter(function (p) { return E.kind(p) === 'menu' || E.kind(p) === 'text'; });
        var plan = planOf();
        h += '<div class="run"><div>';
        h += '<div class="card"><h2>Parameters <span class="pill">' + r.params.length + '</span></h2><div class="params" id="params">' + (r.params.length ? r.params.map(paramControl).join('') : '<div class="muted small">This report has no parameters.</div>') + '</div></div>';
        h += '<div class="card"><h2>Buckets <span class="muted small">run it several times, one slice each — big reports finish, long ranges do not time out</span></h2>' +
            '<div class="field"><label>Split the run</label><select id="b-mode"><option value="none" ' + (b.mode === 'none' ? 'selected' : '') + '>No — one run</option><option value="date" ' + (b.mode === 'date' ? 'selected' : '') + '>By date range</option><option value="value" ' + (b.mode === 'value' ? 'selected' : '') + '>By the values of a parameter</option><option value="both" ' + (b.mode === 'both' ? 'selected' : '') + '>Dates × values</option></select></div>';
        if (b.mode === 'date' || b.mode === 'both') h += '<div class="form" style="margin-top:8px"><div class="field"><label>From parameter</label><select id="b-from">' + dates.map(function (p) { return '<option ' + (b.fromParam === p.name ? 'selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div><div class="field"><label>To parameter</label><select id="b-to">' + dates.map(function (p) { return '<option ' + (b.toParam === p.name ? 'selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div><div class="field"><label>Bucket</label><select id="b-by">' + [['days', 'Every n days'], ['week', 'Weekly'], ['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Yearly']].map(function (x) { return '<option value="' + x[0] + '" ' + (b.by === x[0] ? 'selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div><div class="field" ' + (b.by === 'days' ? '' : 'style="display:none"') + '><label>Days per bucket</label><input type="number" id="b-n" min="1" max="366" value="' + esc(b.n || 7) + '"></div></div>' + (dates.length < 2 ? '<div class="warnbox" style="margin-top:6px">This report has fewer than two date parameters — date buckets need a from and a to.</div>' : '<div class="muted small" style="margin-top:6px">The from / to dates come from the parameter values above.</div>');
        if (b.mode === 'value' || b.mode === 'both') h += '<div class="form" style="margin-top:8px"><div class="field"><label>Parameter</label><select id="b-vparam">' + menus.map(function (p) { return '<option ' + (b.valueParam === p.name ? 'selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div><div class="field wide"><label>Values (one per line; empty = every value of the list' + (lovOf(b.valueParam).length ? ', ' + lovOf(b.valueParam).length + ' here' : '') + ')</label><textarea id="b-values" rows="4">' + esc((b.values || []).join('\n')) + '</textarea></div></div>';
        if (b.mode !== 'none') h += '<div style="margin-top:8px"><b>' + plan.length + ' runs</b>' + (plan.length ? ' <span class="muted small">' + esc(plan[0].label) + (plan.length > 1 ? ' … ' + esc(plan[plan.length - 1].label) : '') + '</span><div class="plan" style="margin-top:6px">' + plan.slice(0, 400).map(function (x, i) { return '<div><span>' + (i + 1) + '. ' + esc(x.label) + '</span><span class="mono muted">' + esc(Object.keys(x.params).map(function (k) { return k + '=' + x.params[k].join('|'); }).join(' ')) + '</span></div>'; }).join('') + (plan.length > 400 ? '<div>… ' + (plan.length - 400) + ' more</div>' : '') + '</div>' : ' <span class="muted small">— fill the from / to dates or the values</span>') + '</div>';
        h += '</div>';
        var fmts = r.formats || formatsOf(r), defFmt = E.defaultFormat(r.def, fmts), hasCsv = fmts.some(function (f) { return f.value === 'csv'; }), curF = fmts.filter(function (f) { return f.value === r.format; })[0];
        h += '<div class="card"><h2>Output</h2><div class="form"><div class="field"><label>Format <span class="muted">· from the report definition</span></label><select id="r-format">' + fmts.map(function (f) { return '<option value="' + esc(f.value) + '" ' + (r.format === f.value ? 'selected' : '') + '>' + fmtLabel(f) + (f.value === defFmt ? ' · report default' : '') + '</option>'; }).join('') + '</select>' +
            '<div class="muted small" id="r-fmtnote">' + (curF && curF.templates.length ? 'Offered by ' + (curF.templates.length === 1 ? 'layout ' + esc(curF.templates[0]) : curF.templates.length + ' layouts') + ' · ' : '') + (r.format === defFmt ? 'the report\'s default' : 'report default: ' + esc(String(defFmt).toUpperCase())) + (!hasCsv ? ' · <span class="warn">no layout offers CSV — XML data gives the same rows for the grid</span>' : '') + '</div></div>' +
            '<div class="field"><label>Template</label><select id="r-template"><option value="">(default)</option>' + (r.def && r.def.templates || []).map(function (t) { return '<option value="' + esc(t.id) + '" ' + (r.template === t.id ? 'selected' : '') + '>' + esc(t.id) + (t.type ? ' · ' + esc(t.type) : '') + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Chunk (MB)</label><input type="number" id="r-chunk" min="1" max="200" value="' + esc(P.set.chunkMb) + '" title="A report bigger than this is fetched in pieces"></div><div class="field"><label>Time limit (min)</label><input type="number" id="r-timeout" min="1" max="360" value="' + esc(P.set.timeoutMin) + '"></div></div>' +
            '<div class="row" style="margin-top:10px"><button class="btn pri" data-act="run" ' + (P.running ? 'disabled' : '') + '><i class="fas fa-play"></i> Run' + (b.mode !== 'none' && plan.length ? ' ' + plan.length + ' buckets' : '') + '</button><button class="btn" data-act="preview"><i class="fas fa-envelope-open-text"></i> SOAP request</button><span class="sp"></span><span class="muted small">Output goes to this PC (History) and the grid below.</span></div></div>';
        h += '</div><div>';
        if (P.running) h += vProgress();
        if (r.sql) h += vSql(r.sql);
        if (P.result) h += vResult();
        else if (!P.running) h += '<div class="card empty">Set the parameters and press Run. Data output (CSV or XML) comes back as a grid you can filter, pivot, chart and export — and stays in DuckDB; PDF / Excel output opens as a file.</div>';
        h += '</div></div>';
        return h;
    }
    function vProgress() {
        var g = P.running, pct = g.buckets > 1 ? Math.round(((g.bucket - 1) + (g.phase === 'bucketDone' ? 1 : 0.5)) / g.buckets * 100) : null;
        var eta = g.buckets > 1 && g.bucket > 1 ? E.fmtMs((g.ms / Math.max(1, g.bucket - 1)) * (g.buckets - g.bucket + 1)) : '';
        return '<div class="progress"><div class="row"><b><i class="fas fa-spinner fa-spin"></i> ' + esc(g.name) + '</b><span class="pill info">' + esc(g.phase || 'starting') + '</span>' + (g.buckets > 1 ? '<span class="pill">bucket ' + g.bucket + ' of ' + g.buckets + '</span>' : '') + '<span class="sp"></span><button class="btn sm bad" data-act="cancel">Stop</button></div>' +
            '<div class="bar ' + (pct == null ? 'indet' : '') + '"><i style="width:' + (pct == null ? 30 : pct) + '%"></i></div>' +
            '<div class="small muted">' + esc(g.message || '') + ' · ' + E.fmtBytes(g.bytes || 0) + (g.rows ? ' · ' + E.fmtNum(g.rows) + ' rows so far' : '') + ' · ' + E.fmtMs(g.ms || 0) + (eta ? ' · about ' + eta + ' left' : '') + '</div></div>';
    }
    function startRun() {
        var r = P.rep; if (!r || P.running) return;
        readForm();
        var plan = r.bucket.mode === 'none' ? [] : planOf();
        if (r.bucket.mode !== 'none' && !plan.length) { toast('Nothing to split: set the dates or values of the buckets', 'warn'); return; }
        if (plan.length > 1 && !E.isData(r.format) && !confirm(plan.length + ' runs in ' + r.format.toUpperCase() + ' give ' + plan.length + ' files (data buckets — CSV or XML — are joined into one grid). Continue?')) return;
        var params = E.encode(r.params, r.values);
        var body = { instance: P.pod, path: r.path, name: r.name, format: r.format, template: r.template || null, params: params, buckets: plan, chunkBytes: Math.round((P.set.chunkMb || 8) * 1000000), timeoutMs: Math.round((P.set.timeoutMin || 20) * 60000), sample: Math.min(P.set.rowsAtOnce || 20000, 50000) };
        P.running = { name: r.name, path: r.path, phase: 'starting', bucket: 1, buckets: plan.length || 1, bytes: 0, rows: 0, ms: 0, t0: Date.now() };
        P.result = null; render();
        var tick = setInterval(function () { if (!P.running) { clearInterval(tick); return; } P.running.ms = Date.now() - P.running.t0; var pr = document.querySelector('.progress'); if (pr) pr.outerHTML = vProgress(); }, 1000);
        S.bip('bipRun', body, 0, function (pr) { if (!P.running) return; Object.assign(P.running, pr); P.running.ms = Date.now() - P.running.t0; var el = document.querySelector('.progress'); if (el) el.outerHTML = vProgress(); })
            .then(function (d) { onRunDone(d, r, plan.length, params); })
            .catch(function (e) {
                P.running = null; clearInterval(tick);
                var d = e.data || {};
                S.runLog.add({ pod: P.pod, path: r.path, name: r.name, pc: P.status && P.status.pc, runId: d.runId, format: r.format, buckets: plan.length, rows: 0, bytes: 0, ms: d.ms, status: d.status || 'FAILED', error: e.message, params: JSON.stringify(params).slice(0, 4000) });
                toast(e.message, 'bad', 12000); render();
            });
    }
    function onRunDone(d, r, buckets, params) {
        P.running = null;
        P.result = { runId: d.runId, pod: d.pod, path: r.path, name: r.name, format: d.format, file: d.file, files: d.files || [], columns: d.columns || [], rows: d.sample || [], total: d.rows || 0, bytes: d.bytes, ms: d.ms, buckets: d.buckets, done: d.done, failed: d.failed || [], status: d.status, error: d.error, chunks: d.chunks, dir: d.dir, loaded: (d.sample || []).length, duck: !!d.duck, tbl: d.tbl || null, hash: d.hash, notes: d.notes || [] };
        if (d.format && r.format !== d.format && E.isData(d.format)) r.format = d.format;
        S.runLog.add({ pod: P.pod, path: r.path, name: r.name, pc: P.status && P.status.pc, runId: d.runId, format: d.format, buckets: buckets, rows: d.rows, bytes: d.bytes, ms: d.ms, status: d.status, error: d.error, params: JSON.stringify(params).slice(0, 4000) });
        toast(r.name + ': ' + (E.isData(d.format) ? E.fmtNum(d.rows) + ' rows' : E.fmtBytes(d.bytes)) + ' in ' + E.fmtMs(d.ms) + (d.failed && d.failed.length ? ' · ' + d.failed.length + ' bucket(s) failed' : '') + (d.notes && d.notes.length ? ' · ' + d.notes[0] : ''), d.failed && d.failed.length ? 'warn' : 'ok', 6000);
        if (!E.isData(d.format) && d.files && d.files.length === 1) S.bip('bipRunOpen', { runId: d.runId, file: d.files[0] }).catch(function () { });
        render();
    }
    function loadMore() {
        var R = P.result; if (!R || R.loaded >= R.total) return;
        run('Reading more rows…', function () { return S.bip('bipRows', { runId: R.runId, offset: R.loaded, limit: P.set.rowsAtOnce || 20000 }, 600000); }).then(function (d) { R.rows = R.rows.concat(d.rows || []); R.loaded = R.rows.length; R.total = d.total; if (!R.columns.length) R.columns = d.columns || []; R._sum = null; if (P.resView === 'grid' && P._grid && $('grid')) { P._grid.setRows(R.rows, R.columns, R.loaded < R.total ? moreOf(R) : null); var k = document.querySelector('.kpis .kpi .s'); if (k) k.innerHTML = R.loaded < R.total ? esc(E.fmtNum(R.loaded)) + ' loaded · <a data-act="more" style="color:var(--pri);cursor:pointer">load more</a>' : ''; } else render(); });
    }
    function vResult() {
        var R = P.result, isData = E.isData(R.format);
        var h = '<div class="card"><div class="row"><div><b>' + esc(R.name) + '</b> <span class="pill ' + (R.status === 'DONE' ? 'ok' : R.status === 'PARTIAL' ? 'warn' : 'bad') + '">' + esc(R.status) + '</span> <span class="muted small">run ' + esc(R.runId) + ' · ' + esc(R.pod) + ' · ' + esc(String(R.format).toUpperCase()) + '</span>' + (R.duck ? ' <span class="src duck" title="The rows are kept in this PC\'s DuckDB file as table ' + esc(R.tbl) + ' — the Explore tab queries it"><i class="fas fa-database"></i> kept in DuckDB · ' + esc(R.tbl) + '</span>' : '') + '</div><span class="sp"></span>' +
            (R.duck ? '<button class="btn sm" data-act="exploreRes" data-tbl="' + esc(R.tbl) + '" title="Query these rows with SQL in the Explore tab"><i class="fas fa-terminal"></i> SQL</button>' : '') +
            (isData ? '<button class="btn sm" data-act="excel" ' + (R.rows.length ? '' : 'disabled') + '><i class="fas fa-file-excel"></i> Excel</button><button class="btn sm" data-act="copy" ' + (R.rows.length ? '' : 'disabled') + '><i class="fas fa-copy"></i> Copy</button>' : '') +
            '<button class="btn sm" data-act="saveAs"><i class="fas fa-download"></i> Save as…</button><button class="btn sm" data-act="openFile"><i class="fas fa-arrow-up-right-from-square"></i> Open file</button><button class="btn sm" data-act="folder"><i class="fas fa-folder-open"></i> Folder</button><button class="btn sm ghost" data-act="closeResult">✕</button></div>' +
            '<div class="kpis" style="margin-top:10px"><div class="kpi"><div class="l">Rows</div><div class="v">' + (isData ? esc(E.fmtNum(R.total)) : '—') + '</div><div class="s">' + (isData && R.loaded < R.total ? esc(E.fmtNum(R.loaded)) + ' loaded · <a data-act="more" style="color:var(--pri);cursor:pointer">load more</a>' : '') + '</div></div><div class="kpi"><div class="l">Columns</div><div class="v">' + R.columns.length + '</div></div><div class="kpi"><div class="l">Buckets</div><div class="v">' + (R.buckets || 1) + '</div><div class="s">' + (R.failed.length ? '<span class="bad">' + R.failed.length + ' failed</span>' : 'all ran') + '</div></div><div class="kpi"><div class="l">Size</div><div class="v">' + esc(E.fmtBytes(R.bytes)) + '</div><div class="s">' + (R.chunks > 1 ? R.chunks + ' chunks' : '') + '</div></div><div class="kpi"><div class="l">Time</div><div class="v">' + esc(E.fmtMs(R.ms)) + '</div></div></div>' +
            (R.failed.length ? '<div class="badbox" style="margin-bottom:10px"><b>' + R.failed.length + ' bucket(s) failed</b> — ' + R.failed.slice(0, 5).map(function (f) { return esc(f.label) + ': ' + esc(f.error); }).join(' · ') + (R.failed.length > 5 ? ' …' : '') + ' <button class="btn sm" data-act="retryFailed">Run the failed buckets again</button></div>' : '') + (R.error ? '<div class="badbox" style="margin-bottom:10px">' + esc(R.error) + '</div>' : '') +
            (R.notes && R.notes.length ? '<div class="warnbox" style="margin-bottom:10px"><i class="fas fa-circle-info"></i> ' + R.notes.map(esc).join('<br>') + '</div>' : '');
        if (!isData) { h += '<div class="muted small">The file was saved on this PC (' + esc(R.file) + (R.files.length > 1 ? ' and ' + (R.files.length - 1) + ' more' : '') + '). Open it, save it elsewhere, or run the report in a data format (CSV / XML) to analyse it here.</div></div>'; return h; }
        h += '<div class="res-tabs">' + [['grid', 'Grid'], ['pivot', 'Pivot'], ['chart', 'Chart'], ['summary', 'Summary']].map(function (t) { return '<button data-act="resView" data-v="' + t[0] + '" class="' + (P.resView === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
        if (P.resView === 'grid') h += '<div id="grid" class="gridbox"></div>';
        else if (P.resView === 'pivot') h += '<div id="pivot"></div><div class="muted small" style="margin-top:6px">The layout is kept per report on this PC.</div>';
        else if (P.resView === 'chart') h += vChart();
        else h += vSummary();
        return h + '</div>';
    }
    function vPlainTable(cols, rows) {
        return '<div class="plain"><table class="tbl"><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>' + rows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = r[c]; return '<td class="' + (typeof v === 'number' ? 'r num' : '') + '">' + esc(typeof v === 'number' ? E.fmtNum(v) : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>' + (rows.length < (P.result.rows.length) ? '<div class="muted small" style="padding:6px">first ' + rows.length + ' of ' + P.result.rows.length + ' loaded rows</div>' : '') + '</div>';
    }
    function colKinds() { var R = P.result; if (!R._sum || R._sumN !== R.rows.length) { R._sum = E.summary(R.rows.slice(0, 5000), R.columns); R._sumN = R.rows.length; } return R._sum; }
    function vChart() {
        var R = P.result, k = colKinds(), cats = k.filter(function (c) { return c.kind !== 'number'; }), nums = k.filter(function (c) { return c.kind === 'number'; }), c = P.chart;
        if (!c.x || !k.some(function (x) { return x.column === c.x; })) c.x = (cats[0] || k[0] || {}).column;
        if (!c.y || !k.some(function (x) { return x.column === c.y; })) c.y = (nums[0] || {}).column || '';
        return '<div class="row" style="margin-bottom:8px"><div class="field"><label>Category</label><select id="c-x">' + k.map(function (x) { return '<option ' + (c.x === x.column ? 'selected' : '') + '>' + esc(x.column) + '</option>'; }).join('') + '</select></div><div class="field"><label>Value</label><select id="c-y"><option value="">(count of rows)</option>' + nums.map(function (x) { return '<option ' + (c.y === x.column ? 'selected' : '') + '>' + esc(x.column) + '</option>'; }).join('') + '</select></div><div class="field"><label>Function</label><select id="c-fn">' + ['sum', 'avg', 'min', 'max', 'count'].map(function (f) { return '<option ' + (c.fn === f ? 'selected' : '') + '>' + f + '</option>'; }).join('') + '</select></div><div class="field"><label>Type</label><select id="c-type">' + ['bar', 'line', 'pie', 'doughnut'].map(function (f) { return '<option ' + (c.type === f ? 'selected' : '') + '>' + f + '</option>'; }).join('') + '</select></div><div class="field"><label>Top</label><input type="number" id="c-top" min="2" max="200" value="' + esc(c.top || 20) + '" style="width:80px"></div></div><div class="chartbox"><canvas id="chart"></canvas></div>' + (window.Chart ? '' : '<div class="warnbox">Chart.js is not loaded (no CDN?) — the table below shows the same numbers.</div>' + vAggTable());
    }
    function vAggTable() { var c = P.chart, a = E.agg(P.result.rows, { groupBy: c.x, valueCol: c.y || null, fn: c.y ? c.fn : 'count', top: c.top || 20 }); return '<table class="tbl"><tr><th>' + esc(c.x) + '</th><th class="r">' + esc(c.y ? c.fn + ' of ' + c.y : 'rows') + '</th></tr>' + a.map(function (x) { return '<tr><td>' + esc(x.key) + '</td><td class="r num">' + esc(E.fmtNum(x.value)) + '</td></tr>'; }).join('') + '</table>'; }
    function vSummary() {
        var k = colKinds();
        return '<div class="muted small" style="margin-bottom:6px">Facts per column over the first ' + E.fmtNum(Math.min(5000, P.result.rows.length)) + ' loaded rows.</div><table class="tbl"><tr><th>Column</th><th>Kind</th><th class="r">Filled</th><th class="r">Distinct</th><th class="r">Sum</th><th class="r">Avg</th><th class="r">Min</th><th class="r">Max</th></tr>' + k.map(function (c) { return '<tr><td><b>' + esc(c.column) + '</b></td><td>' + esc(c.kind) + '</td><td class="r num">' + esc(E.fmtNum(c.rows - c.nulls)) + '</td><td class="r num">' + esc(E.fmtNum(c.distinct)) + '</td><td class="r num">' + (c.sum != null ? esc(E.fmtNum(c.sum)) : '') + '</td><td class="r num">' + (c.avg != null ? esc(E.fmtNum(c.avg, 2)) : '') + '</td><td class="r num">' + (c.min != null ? esc(E.fmtNum(c.min)) : '') + '</td><td class="r num">' + (c.max != null ? esc(E.fmtNum(c.max)) : '') + '</td></tr>'; }).join('') + '</table>';
    }
    function vSql(m) {
        return '<div class="card sql"><div class="row"><h2 style="margin:0">SQL behind the report <span class="muted small">data model ' + esc(m.dataModel) + (m.model && m.model.defaultDataSource ? ' · ' + esc(m.model.defaultDataSource) : '') + '</span></h2><span class="sp"></span><button class="btn sm ghost" data-act="sqlClose">✕</button></div>' +
            (m.model && m.model.dataSets.length ? m.model.dataSets.map(function (d, i) { return '<h3>' + esc(d.name || 'data set ' + (i + 1)) + (d.type ? ' · ' + esc(d.type) : '') + ' <button class="btn sm" data-act="sqlCopy" data-i="' + i + '">Copy</button> <button class="btn sm" data-act="sqlFusion" data-i="' + i + '" title="Open it in Fusion SQL and run it straight away (read-only)"><i class="fas fa-database"></i> Open in Fusion SQL</button></h3><pre class="code">' + esc(d.sql) + '</pre>'; }).join('') : '<div class="muted small">No SQL data set in this data model (it may be a web service, LDAP or BI Answers data set).</div>') +
            (m.model && m.model.parameters.length ? '<h3>Parameters of the data model</h3><table class="tbl"><tr><th>Name</th><th>Type</th><th>Default</th><th>Label</th></tr>' + m.model.parameters.map(function (p) { return '<tr><td class="mono">' + esc(p.name) + '</td><td>' + esc(p.dataType || '') + '</td><td>' + esc(p.defaultValue || '') + '</td><td>' + esc(p.label || '') + '</td></tr>'; }).join('') + '</table>' : '') + '</div>';
    }
    function moreOf(R) { return { loaded: R.loaded, total: R.total, onMore: loadMore }; }
    function afterRun() {
        var R = P.result; if (!R || !E.isData(R.format)) return;
        if (P.resView === 'grid' && $('grid')) P._grid = G.grid($('grid'), { columns: R.columns, rows: R.rows, height: 560, key: 'res:' + R.path, name: R.name, toast: toast, more: R.loaded < R.total ? moreOf(R) : null });
        if (P.resView === 'pivot' && $('pivot')) P._pivot = G.pivot($('pivot'), { columns: R.columns, rows: R.rows, name: R.name, state: ls('pivot.' + R.path, null), onState: function (st) { lsSet('pivot.' + R.path, st); }, toast: toast });
        if (P.resView === 'chart' && window.Chart && $('chart')) drawChart('chart', P.result.rows, P.chart, 'main');
    }
    function drawChart(canvasId, rows, c, key) {
        var a = E.agg(rows, { groupBy: c.x, valueCol: c.y || null, fn: c.y ? c.fn : 'count', top: c.top || 20 });
        var pal = ['#1e3a8a', '#0ea5e9', '#059669', '#f59e0b', '#c74634', '#7c3aed', '#0d9488', '#64748b', '#dc2626', '#2563eb'];
        if (charts[key]) { try { charts[key].destroy(); } catch (e) { } }
        var pie = c.type === 'pie' || c.type === 'doughnut';
        charts[key] = new Chart($(canvasId).getContext('2d'), { type: c.type || 'bar', data: { labels: a.map(function (x) { return x.key; }), datasets: [{ label: c.y ? c.fn + ' of ' + c.y : 'rows', data: a.map(function (x) { return Math.round(x.value * 100) / 100; }), backgroundColor: pie ? a.map(function (x, i) { return pal[i % pal.length]; }) : pal[0] + 'cc', borderColor: pal[0], borderWidth: 1, tension: .3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: pie } }, scales: pie ? {} : { y: { beginAtZero: true } } } });
    }
    function exportExcel() {
        var R = P.result; if (!R || !window.ExcelJS || !window.saveAs) { toast('Excel export needs ExcelJS (CDN)', 'warn'); return; }
        var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(R.name.slice(0, 30) || 'Report');
        ws.addRow(R.columns); R.rows.forEach(function (r) { ws.addRow(R.columns.map(function (c) { return r[c]; })); });
        ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
        wb.xlsx.writeBuffer().then(function (buf) { saveAs(new Blob([buf], { type: 'application/octet-stream' }), R.name + '.xlsx'); });
    }
    function showSql(path) {
        return run('Reading the data model…', function () { return S.bip('bipDataModel', { instance: P.pod, path: path }, 300000); }).then(function (d) {
            if (P.rep && (P.rep.path === path || P.rep.def && P.rep.def.dataModelUrl === path)) { P.rep.sql = d; render(); }
            else drawer({ title: 'SQL of ' + nameOf(path), html: vSql(d), foot: '<button class="btn" data-act="drawerClose">Close</button>', state: { sql: d } });
        });
    }
    function toFusionSql(i) {
        var m = (P.rep && P.rep.sql) || (P.drawer && P.drawer.state && P.drawer.state.sql); if (!m) return;
        var ds = m.model.dataSets[+i]; if (!ds) return;
        var sql = String(ds.sql).replace(/:(\w+)/g, function (x, n) { var v = P.rep && P.rep.values && P.rep.values[n]; return v != null && v !== '' && !Array.isArray(v) ? "'" + String(v).replace(/'/g, "''") + "'" : x; });
        try { localStorage.setItem('fusionSql.editor', JSON.stringify('-- from BIP report ' + (P.rep ? P.rep.path : m.dataModel) + '\n' + sql)); localStorage.setItem('fusionSql.tab', JSON.stringify('builder')); } catch (e) { }
        window.open('../fusionsql/index.html', '_blank');
    }

    // ── Dashboards ────────────────────────────────────────────────
    function loadDashes() { return S.dash.list(P.pod).then(function (l) { P.dashes = l; if (!P.dash && l.length) { var last = ls('dash'); var pick = l.filter(function (d) { return d.ID === last; })[0] || l[0]; openDash(pick.ID); } else render(); }).catch(function (e) { toast(e.message, 'bad'); }); }
    function openDash(id) { return run('Opening the dashboard…', function () { return S.dash.get(id); }).then(function (d) { if (!d) { toast('Dashboard not found', 'bad'); return; } P.dash = d; d.cards = d.cards || []; lsSet('dash', id); render(); scheduleDash(); prefillCards(d); }); }
    /** Every card without a result this session shows the newest kept result of exactly its parameters and buckets (DuckDB), one card after another. */
    function prefillCards(d) {
        var cards = (d.cards || []).filter(function (c) { return !P.dashRes[c.id] && !P.dashBusy[c.id]; });
        return cards.reduce(function (p, c) {
            return p.then(function () {
                if (P.dash !== d) return;
                return S.bip('bipLastRun', { instance: c.pod || P.pod, path: c.path, params: c.params || {}, buckets: cardPlan(c), limit: c.show === 'number' ? 5000 : 200 }, 60000).then(function (x) {
                    if (!x || !x.found || P.dash !== d || P.dashRes[c.id]) return;
                    var run = x.run || {};
                    P.dashRes[c.id] = { at: run.started_at || run.startedAt || '', runId: run.run_id, columns: x.columns || [], rows: x.rows || [], total: x.total || 0, ms: +run.ms || 0, buckets: +run.buckets || 0, format: run.format, src: 'duckdb', fresh: false, error: null };
                    if (P.tab === 'dash') { paintCard(c); afterDashCard(c); }
                }).catch(function () { });
            });
        }, Promise.resolve());
    }
    function saveDash(d) { return run('Saving…', function () { return S.dash.save(d); }).then(function () { return S.dash.list(P.pod); }).then(function (l) { P.dashes = l; render(); }); }
    function vDash() {
        var h = '<div class="dash-head"><select id="d-pick" style="min-width:260px"><option value="">— dashboards on ' + esc(P.pod) + ' —</option>' + P.dashes.map(function (d) { return '<option value="' + esc(d.ID) + '" ' + (P.dash && P.dash.id === d.ID ? 'selected' : '') + '>' + esc(d.NAME) + (d.SHARED === 'N' ? ' (private)' : '') + ' · ' + esc(d.OWNER) + '</option>'; }).join('') + '</select>' +
            '<button class="btn pri" data-act="dashNew"><i class="fas fa-plus"></i> New dashboard</button>' + (P.dash ? '<button class="btn ok" data-act="dashRunAll" ' + (Object.keys(P.dashBusy).length ? 'disabled' : '') + '><i class="fas fa-play"></i> Run all</button><button class="btn" data-act="dashEdit"><i class="fas fa-pen"></i> Rename / share</button><button class="btn" data-act="dashExport"><i class="fas fa-file-export"></i> Export</button><button class="btn" data-act="dashImport"><i class="fas fa-file-import"></i> Import</button><button class="btn ghost" data-act="dashDelete">Delete</button>' : '') + '<span class="sp"></span>' + (P.dash ? '<label class="chk">Refresh every <select id="d-refresh">' + [[0, 'never'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '60 min']].map(function (x) { return '<option value="' + x[0] + '" ' + ((P.dash.refreshMin || 0) === x[0] ? 'selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select> while open</label>' : '') + '</div>';
        if (!P.dash) return h + '<div class="card empty">' + (P.dashes.length ? 'Pick a dashboard.' : 'No dashboards yet. Make one, then add reports to it from the Catalog or the Run tab — every card remembers its parameters and buckets and shows a number, a table, a chart or a pivot.') + '</div>';
        var d = P.dash;
        if (!d.cards.length) return h + '<div class="card empty"><b>' + esc(d.name) + '</b> has no cards yet — open a report and press <i>Add to a dashboard</i>.</div>';
        return h + '<div class="cards">' + d.cards.map(vCard).join('') + '</div>';
    }
    function vCard(c) {
        var res = P.dashRes[c.id] || ls('cardRes.' + c.id, null), busyC = P.dashBusy[c.id];
        var st = busyC ? '<span class="pill warn"><i class="fas fa-spinner fa-spin"></i> ' + esc(busyC.message || busyC.phase || 'running') + (busyC.buckets > 1 ? ' · ' + busyC.bucket + '/' + busyC.buckets : '') + '</span>' : res ? (res.error ? '<span class="pill bad">failed</span> ' + esc(res.error) : '<span class="muted">' + esc(fmt(res.at)) + ' · ' + esc(E.fmtNum(res.total)) + ' rows · ' + esc(E.fmtMs(res.ms)) + (res.buckets > 1 ? ' · ' + res.buckets + ' buckets' : '') + (res.src === 'duckdb' && !res.fresh ? ' · <i class="fas fa-database" title="The last kept result of exactly these parameters, from this PC\'s DuckDB — press Run for fresh rows"></i> from DuckDB' : '') + '</span>') : '<span class="muted">not run yet</span>';
        var body = '';
        if (res && !res.error) {
            if (c.show === 'number') { var v = E.cardValue(res.rows, c.number || { mode: 'count' }); body = '<div class="big ' + (c.number && c.number.redBelow != null && E.num(v) != null && E.num(v) < +c.number.redBelow ? 'bad' : '') + '">' + esc(typeof v === 'number' ? E.fmtNum(v, c.number && c.number.dec) : v) + '</div><div class="muted small">' + esc(c.number && c.number.mode !== 'count' ? c.number.mode + ' of ' + c.number.column : 'rows') + (res.total > res.rows.length ? ' · over the first ' + E.fmtNum(res.rows.length) + ' rows' : '') + '</div>'; }
            else if (c.show === 'chart') body = '<div class="cb"><canvas id="cc-' + esc(c.id) + '"></canvas></div>';
            else body = '<div class="mini">' + vPlainTable(res.columns.slice(0, c.cols || 6), res.rows.slice(0, c.rowsShown || 8)).replace('class="plain"', '') + '</div>';
        } else if (!res && !busyC) body = '<div class="muted small" style="padding:10px 0">Press Run.</div>';
        return '<div class="dcard w' + (c.w || 1) + (busyC ? ' running' : '') + (res && res.error ? ' err' : '') + '" data-card="' + esc(c.id) + '"><div class="h"><div class="t">' + esc(c.title || c.name) + '</div><span class="pill" title="Runs as ' + esc(String(c.format || 'the report\'s data format').toUpperCase()) + '">' + esc(c.show || 'table') + (c.format ? ' · ' + esc(String(c.format).toUpperCase()) : '') + '</span></div><div class="st">' + esc(c.path) + '</div><div class="st">' + st + '</div>' + body +
            '<div class="acts"><button class="btn sm pri" data-act="cardRun" data-id="' + esc(c.id) + '" ' + (busyC ? 'disabled' : '') + '><i class="fas fa-play"></i> Run</button><button class="btn sm" data-act="cardOpen" data-id="' + esc(c.id) + '" title="Open in the Run tab with these parameters"><i class="fas fa-arrow-up-right-from-square"></i></button><button class="btn sm" data-act="cardEdit" data-id="' + esc(c.id) + '"><i class="fas fa-pen"></i></button><button class="btn sm" data-act="cardLeft" data-id="' + esc(c.id) + '" title="Move left">◀</button><button class="btn sm" data-act="cardRight" data-id="' + esc(c.id) + '" title="Move right">▶</button><button class="btn sm ghost" data-act="cardRemove" data-id="' + esc(c.id) + '">✕</button></div></div>';
    }
    function afterDash() {
        if (!P.dash || !window.Chart) return;
        P.dash.cards.forEach(function (c) { var res = P.dashRes[c.id] || ls('cardRes.' + c.id, null); if (c.show === 'chart' && res && !res.error && $('cc-' + c.id)) drawChart('cc-' + c.id, res.rows, Object.assign({ type: 'bar', fn: 'sum', top: 12 }, c.chart || {}), 'card:' + c.id); });
    }
    /** The format a card runs with: the one kept on the card (set when it was added), else the report definition's data format (never a hard-coded csv). */
    function cardFormat(c) {
        if (c.format && E.isData(c.format)) return Promise.resolve(c.format);
        return S.bip('bipDefinition', { instance: c.pod || P.pod, path: c.path }).then(function (d) { var fm = E.formats(d.def); c.format = E.dataFormat(d.def, fm); c.formats = fm.filter(function (f) { return f.data; }).map(function (f) { return f.value; }); return c.format; }).catch(function () { c.format = 'xml'; return 'xml'; });
    }
    function runCard(c) {
        if (P.dashBusy[c.id]) return Promise.resolve();
        P.dashBusy[c.id] = { phase: 'starting' }; paintCard(c);
        var plan = cardPlan(c), fmt = c.format;
        return cardFormat(c).then(function (f) {
            fmt = f;
            var body = { instance: c.pod || P.pod, path: c.path, name: c.name, format: fmt, template: c.template || null, params: c.params || {}, buckets: plan, chunkBytes: Math.round((P.set.chunkMb || 8) * 1000000), timeoutMs: Math.round((P.set.timeoutMin || 20) * 60000), sample: 5000 };
            return S.bip('bipRun', body, 0, function (pr) { if (P.dashBusy[c.id]) { Object.assign(P.dashBusy[c.id], pr); paintCard(c); } });
        })
            .then(function (d) { var res = { at: new Date().toISOString(), runId: d.runId, columns: d.columns || [], rows: d.sample || [], total: d.rows || 0, ms: d.ms, buckets: d.buckets, bytes: d.bytes, format: d.format, src: d.duck ? 'duckdb' : 'file', fresh: true, error: d.failed && d.failed.length === d.buckets && d.buckets ? 'every bucket failed' : null }; P.dashRes[c.id] = res; lsSet('cardRes.' + c.id, { at: res.at, runId: res.runId, columns: res.columns, rows: res.rows.slice(0, c.show === 'number' ? 5000 : 200), total: res.total, ms: res.ms, buckets: res.buckets, error: res.error }); S.runLog.add({ pod: c.pod || P.pod, path: c.path, name: c.name, pc: P.status && P.status.pc, runId: d.runId, format: d.format || fmt, buckets: plan.length, rows: d.rows, bytes: d.bytes, ms: d.ms, status: d.status, error: d.error, params: JSON.stringify(c.params || {}).slice(0, 4000) }); })
            .catch(function (e) { P.dashRes[c.id] = { at: new Date().toISOString(), error: e.message, rows: [], columns: [], total: 0 }; lsSet('cardRes.' + c.id, P.dashRes[c.id]); })
            .then(function () { delete P.dashBusy[c.id]; if (P.tab === 'dash') { paintCard(c); afterDashCard(c); } });
    }
    function cardPlan(c) {
        var b = c.bucket; if (!b || !b.mode || b.mode === 'none') return [];
        var o = { params: c.paramDefs || [] };
        if ((b.mode === 'date' || b.mode === 'both') && b.fromParam && b.toParam) {
            var from = b.from, to = b.to;
            if (b.rolling) { var today = new Date(); to = E.iso(today); from = E.iso(E.addDays(today, -(+b.rollingDays || 30))); }
            o.dateBucket = { fromParam: b.fromParam, toParam: b.toParam, by: b.by, n: b.by === 'days' ? b.n : 1, from: from, to: to };
        }
        if ((b.mode === 'value' || b.mode === 'both') && b.valueParam) o.valueBucket = { param: b.valueParam, values: b.values || [] };
        return E.plan(o);
    }
    function paintCard(c) { var el = document.querySelector('[data-card="' + c.id + '"]'); if (el) { el.outerHTML = vCard(c); } }
    function afterDashCard(c) { var res = P.dashRes[c.id]; if (c.show === 'chart' && res && !res.error && window.Chart && $('cc-' + c.id)) drawChart('cc-' + c.id, res.rows, Object.assign({ type: 'bar', fn: 'sum', top: 12 }, c.chart || {}), 'card:' + c.id); }
    function runAll() { if (!P.dash) return; var cards = P.dash.cards.slice(); return cards.reduce(function (p, c) { return p.then(function () { return runCard(c); }); }, Promise.resolve()).then(function () { toast('Dashboard refreshed', 'ok'); }); }
    function scheduleDash() { clearInterval(P.dashTimer); if (!P.dash || !P.dash.refreshMin) return; P.dashTimer = setInterval(function () { if (P.tab === 'dash' && document.visibilityState === 'visible') runAll(); }, P.dash.refreshMin * 60000); }
    function addCardDialog(path, name, fromRun) {
        var r = fromRun ? P.rep : null;
        var dataFmts = r ? (r.formats || formatsOf(r)).filter(function (f) { return f.data; }) : [{ value: 'xml', label: 'XML data', data: true, always: true }];
        var cardFmt = r ? (E.isData(r.format) ? r.format : E.dataFormat(r.def, r.formats)) : 'xml';
        var h = '<div class="form"><div class="field wide"><label>Dashboard</label><select id="ac-dash"><option value="__new">— new dashboard —</option>' + P.dashes.map(function (d) { return '<option value="' + esc(d.ID) + '" ' + (P.dash && P.dash.id === d.ID ? 'selected' : '') + '>' + esc(d.NAME) + '</option>'; }).join('') + '</select></div><div class="field" id="ac-newbox"><label>New dashboard name</label><input type="text" id="ac-newname" value="My reports"></div>' +
            '<div class="field"><label>Card title</label><input type="text" id="ac-title" value="' + esc(name) + '"></div><div class="field"><label>Show</label><select id="ac-show"><option value="table">Table (first rows)</option><option value="number">One number</option><option value="chart">Chart</option></select></div>' +
            '<div class="field"><label>Number: function</label><select id="ac-mode"><option value="count">count of rows</option><option value="sum">sum of a column</option><option value="avg">average of a column</option><option value="min">min</option><option value="max">max</option><option value="first">first row\'s value</option></select></div><div class="field"><label>Column (number / chart value)</label><input type="text" id="ac-col" placeholder="e.g. AMOUNT"></div><div class="field"><label>Chart: category column</label><input type="text" id="ac-x" placeholder="e.g. CUSTOMER"></div><div class="field"><label>Width</label><select id="ac-w"><option value="1">1 of 3</option><option value="2">2 of 3</option><option value="3">full row</option></select></div>' +
            (r && r.bucket && r.bucket.mode !== 'none' && r.bucket.fromParam ? '<div class="field wide"><label class="chk"><input type="checkbox" id="ac-rolling" checked> Rolling dates: run the last <input type="number" id="ac-days" value="30" style="width:80px"> days up to today (instead of the fixed dates)</label></div>' : '') +
            '<div class="field"><label>Runs as <span class="muted">· a data format of the report</span></label><select id="ac-format">' + dataFmts.map(function (f) { return '<option value="' + esc(f.value) + '" ' + (f.value === cardFmt ? 'selected' : '') + '>' + esc(f.label) + (f.value === cardFmt ? ' · the report\'s default' : '') + '</option>'; }).join('') + '</select><div class="muted small" id="ac-fmtnote">' + (r ? '' : 'reading the report definition…') + '</div></div>' +
            '<div class="muted small wide">' + (r ? 'The card keeps the parameter values, buckets and format set in the Run tab.' : 'The card runs the report with its default parameter values and the data format of its definition; open it in the Run tab to set them, then add it from there.') + '</div></div>';
        drawer({ title: 'Add to a dashboard', html: h, foot: '<button class="btn" data-act="drawerClose">Cancel</button><span class="sp"></span><button class="btn pri" data-act="addCardGo">Add</button>', state: { kind: 'addCard', path: path, name: name, fromRun: fromRun } });
        if (!P.dashes.length) S.dash.list(P.pod).then(function (l) { P.dashes = l; var sel = $('ac-dash'); if (sel) sel.innerHTML = '<option value="__new">— new dashboard —</option>' + l.map(function (d) { return '<option value="' + esc(d.ID) + '">' + esc(d.NAME) + '</option>'; }).join(''); }).catch(function () { });
        if (!r) S.bip('bipDefinition', { instance: P.pod, path: path }).then(function (d) {
            var sel = $('ac-format'), note = $('ac-fmtnote'); if (!sel) return;
            var fm = E.formats(d.def), df = E.dataFormat(d.def, fm), fmts = fm.filter(function (f) { return f.data; });
            sel.innerHTML = fmts.map(function (f) { return '<option value="' + esc(f.value) + '" ' + (f.value === df ? 'selected' : '') + '>' + esc(f.label) + (f.value === df ? ' · the report\'s default' : '') + '</option>'; }).join('');
            if (note) note.textContent = 'Report default: ' + String(E.defaultFormat(d.def, fm)).toUpperCase() + (fm.some(function (f) { return f.value === 'csv'; }) ? '' : ' · no layout offers CSV, XML data gives the rows');
        }).catch(function (e) { var note = $('ac-fmtnote'); if (note) note.textContent = 'Definition not read (' + e.message + ') — XML data always works'; });
    }
    function addCardGo() {
        var st = P.drawer.state, r = st.fromRun ? P.rep : null;
        if (r) readForm();
        var card = { id: uid('c'), title: $('ac-title').value.trim() || st.name, path: st.path, name: st.name, pod: P.pod, show: $('ac-show').value, w: +$('ac-w').value || 1, format: ($('ac-format') && $('ac-format').value) || 'xml', formats: $('ac-format') ? [].map.call($('ac-format').options, function (o) { return o.value; }) : ['xml'], number: { mode: $('ac-mode').value, column: $('ac-col').value.trim(), dec: null }, chart: { x: $('ac-x').value.trim(), y: $('ac-col').value.trim(), fn: 'sum', type: 'bar', top: 12 },
            params: r ? E.encode(r.params, r.values) : {}, values: r ? r.values : {}, template: r ? r.template : '', paramDefs: r ? r.params.map(function (p) { return { name: p.name, dataType: p.dataType, uiType: p.uiType, dateFormatString: p.dateFormatString, lovLabels: (p.lovLabels || []).slice(0, 200), multiValuesAllowed: p.multiValuesAllowed, selectAsAll: p.selectAsAll, useNullForAll: p.useNullForAll }; }) : [], bucket: r ? Object.assign({}, r.bucket, { from: r.values[r.bucket.fromParam], to: r.values[r.bucket.toParam], rolling: !!($('ac-rolling') && $('ac-rolling').checked), rollingDays: +(($('ac-days') || {}).value || 30) }) : { mode: 'none' } };
        var pick = $('ac-dash').value;
        var p = pick === '__new' ? Promise.resolve({ id: uid('d'), name: $('ac-newname').value.trim() || 'My reports', pod: P.pod, shared: true, cards: [], refreshMin: 0 }) : (P.dash && P.dash.id === pick ? Promise.resolve(P.dash) : S.dash.get(pick));
        p.then(function (d) { d.cards = d.cards || []; d.cards.push(card); P.dash = d; lsSet('dash', d.id); return saveDash(d); }).then(function () { closeDrawer(); toast('Added to ' + P.dash.name, 'ok'); go('dash'); });
    }
    function cardEdit(c) {
        var h = '<div class="form"><div class="field wide"><label>Title</label><input type="text" id="ce-title" value="' + esc(c.title) + '"></div><div class="field"><label>Show</label><select id="ce-show">' + ['table', 'number', 'chart'].map(function (s) { return '<option ' + (c.show === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div><div class="field"><label>Width</label><select id="ce-w">' + [1, 2, 3].map(function (w) { return '<option value="' + w + '" ' + ((c.w || 1) === w ? 'selected' : '') + '>' + (w === 3 ? 'full row' : w + ' of 3') + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Number: function</label><select id="ce-mode">' + ['count', 'sum', 'avg', 'min', 'max', 'first'].map(function (m) { return '<option ' + ((c.number || {}).mode === m ? 'selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div><div class="field"><label>Column</label><input type="text" id="ce-col" value="' + esc((c.number || {}).column || (c.chart || {}).y || '') + '"></div><div class="field"><label>Red below</label><input type="number" id="ce-red" value="' + esc((c.number || {}).redBelow != null ? c.number.redBelow : '') + '"></div>' +
            '<div class="field"><label>Chart: category</label><input type="text" id="ce-x" value="' + esc((c.chart || {}).x || '') + '"></div><div class="field"><label>Chart type</label><select id="ce-type">' + ['bar', 'line', 'pie', 'doughnut'].map(function (t) { return '<option ' + ((c.chart || {}).type === t ? 'selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div><div class="field"><label>Rows shown (table)</label><input type="number" id="ce-rows" value="' + esc(c.rowsShown || 8) + '"></div>' +
            '<div class="field"><label>Runs as</label><select id="ce-format">' + (c.formats && c.formats.length ? c.formats : ['csv', 'xml']).map(function (f) { return '<option value="' + esc(f) + '" ' + ((c.format || 'xml') === f ? 'selected' : '') + '>' + esc(String(f).toUpperCase()) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field wide"><label>Parameters (JSON, as sent to BIP)</label><textarea id="ce-params" rows="4">' + esc(JSON.stringify(c.params || {}, null, 1)) + '</textarea></div>' +
            (c.bucket && c.bucket.mode !== 'none' ? '<div class="field wide"><label class="chk"><input type="checkbox" id="ce-rolling" ' + (c.bucket.rolling ? 'checked' : '') + '> Rolling: the last <input type="number" id="ce-days" value="' + esc(c.bucket.rollingDays || 30) + '" style="width:80px"> days up to today, in ' + esc(c.bucket.by) + ' buckets</label></div>' : '') + '</div>';
        drawer({ title: 'Card · ' + c.name, html: h, foot: '<button class="btn" data-act="drawerClose">Cancel</button><span class="sp"></span><button class="btn pri" data-act="cardEditSave">Save</button>', state: { kind: 'cardEdit', id: c.id } });
    }
    function cardEditSave() {
        var c = P.dash.cards.filter(function (x) { return x.id === P.drawer.state.id; })[0]; if (!c) return;
        c.title = $('ce-title').value.trim() || c.name; c.show = $('ce-show').value; c.w = +$('ce-w').value || 1;
        c.number = Object.assign({}, c.number, { mode: $('ce-mode').value, column: $('ce-col').value.trim(), redBelow: $('ce-red').value === '' ? null : +$('ce-red').value });
        c.chart = Object.assign({}, c.chart, { x: $('ce-x').value.trim(), y: $('ce-col').value.trim(), type: $('ce-type').value }); c.rowsShown = +$('ce-rows').value || 8;
        if ($('ce-format')) c.format = $('ce-format').value;
        try { c.params = JSON.parse($('ce-params').value || '{}'); } catch (e) { toast('Parameters are not valid JSON', 'bad'); return; }
        if ($('ce-rolling')) { c.bucket.rolling = $('ce-rolling').checked; c.bucket.rollingDays = +$('ce-days').value || 30; }
        saveDash(P.dash).then(function () { closeDrawer(); toast('Card saved', 'ok'); });
    }

    // ── History ───────────────────────────────────────────────────
    function loadRuns() { S.bip('bipRuns', {}).then(function (d) { P.runs = d.runs || []; render(); }).catch(function (e) { toast(e.message, 'bad'); }); S.runLog.recent(P.pod, 100).then(function (r) { P.log = r; render(); }).catch(function () { }); }
    function vHistory() {
        var h = '<div class="card"><div class="row"><h2 style="margin:0">Runs on this PC <span class="pill">' + P.runs.length + '</span></h2><span class="sp"></span><button class="btn sm" data-act="reloadRuns"><i class="fas fa-rotate"></i></button><button class="btn sm" data-act="runsFolder"><i class="fas fa-folder-open"></i> Folder</button></div>' +
            (P.runs.length ? '<table class="tbl" style="margin-top:8px"><tr><th>Started</th><th>Report</th><th>Pod</th><th>Format</th><th class="r">Buckets</th><th class="r">Rows</th><th class="r">Size</th><th class="r">Time</th><th>Status</th><th></th></tr>' + P.runs.map(function (r) { return '<tr><td class="num">' + esc(r.startedAt) + '</td><td><b>' + esc(r.name) + '</b><div class="mono small muted">' + esc(r.path) + '</div></td><td>' + esc(r.pod) + '</td><td>' + esc(String(r.format || '').toUpperCase()) + '</td><td class="r num">' + esc(r.buckets || 1) + (r.failed && r.failed.length ? ' <span class="bad">(' + r.failed.length + ' failed)</span>' : '') + '</td><td class="r num">' + esc(E.fmtNum(r.rows || 0)) + '</td><td class="r num">' + esc(E.fmtBytes(r.bytes || 0)) + '</td><td class="r num">' + esc(E.fmtMs(r.ms || 0)) + '</td><td><span class="pill ' + (r.status === 'DONE' ? 'ok' : r.status === 'RUNNING' ? 'info' : r.status === 'PARTIAL' ? 'warn' : 'bad') + '">' + esc(r.status) + '</span>' + (r.duck ? ' <i class="fas fa-database src duck" title="The rows are kept in DuckDB (' + esc(r.tbl || '') + ') — opens at once, Explore can query it"></i>' : '') + (r.notes && r.notes.length ? ' <i class="fas fa-circle-info" title="' + esc(r.notes.join(' ')) + '"></i>' : '') + (r.error ? '<div class="small bad">' + esc(String(r.error).slice(0, 120)) + '</div>' : '') + '</td><td class="act">' + (E.isData(r.format) ? '<button class="btn sm pri" data-act="runOpenResult" data-id="' + esc(r.runId) + '">Open result</button>' : '<button class="btn sm" data-act="runOpenFile" data-id="' + esc(r.runId) + '">Open file</button>') + '<button class="btn sm" data-act="runAgain" data-id="' + esc(r.runId) + '" title="Open the report with these parameters"><i class="fas fa-rotate-right"></i></button><button class="btn sm" data-act="runSaveAs" data-id="' + esc(r.runId) + '"><i class="fas fa-download"></i></button><button class="btn sm ghost" data-act="runDelete" data-id="' + esc(r.runId) + '">✕</button></td></tr>'; }).join('') + '</table>' : '<div class="empty">No runs on this PC yet.</div>') + '</div>';
        h += '<div class="card"><h2>Runs on every PC <span class="muted small">(run log in APEX, ' + esc(P.pod) + ')</span></h2>' + (P.log.length ? '<table class="tbl"><tr><th>When</th><th>Report</th><th>Who</th><th>PC</th><th class="r">Buckets</th><th class="r">Rows</th><th class="r">Time</th><th>Status</th></tr>' + P.log.map(function (r) { return '<tr class="click" data-act="open" data-path="' + esc(r.P) + '"><td class="num">' + esc(r.AT) + '</td><td><b>' + esc(r.N || nameOf(r.P)) + '</b></td><td>' + esc(r.U) + '</td><td>' + esc(r.PC || '') + '</td><td class="r num">' + esc(r.B || 1) + '</td><td class="r num">' + esc(E.fmtNum(r.ROWS_N || 0)) + '</td><td class="r num">' + esc(E.fmtMs(r.MS || 0)) + '</td><td><span class="pill ' + (r.S === 'DONE' ? 'ok' : r.S === 'PARTIAL' ? 'warn' : 'bad') + '">' + esc(r.S) + '</span>' + (r.E ? ' <span class="small bad">' + esc(String(r.E).slice(0, 80)) + '</span>' : '') + '</td></tr>'; }).join('') + '</table>' : '<div class="muted small">Nothing logged yet.</div>') + '</div>';
        return h;
    }
    function openRunResult(id) {
        var r = P.runs.filter(function (x) { return x.runId === id; })[0]; if (!r) return;
        run('Reading the result…', function () { return S.bip('bipRows', { runId: id, offset: 0, limit: P.set.rowsAtOnce || 20000 }, 600000); }).then(function (d) {
            P.result = { runId: id, pod: r.pod, path: r.path, name: r.name, format: r.format, file: r.file, files: r.files || [], columns: d.columns || [], rows: d.rows || [], total: d.total, bytes: r.bytes, ms: r.ms, buckets: r.buckets, done: r.done, failed: r.failed || [], status: r.status, error: r.error, chunks: r.chunks, loaded: (d.rows || []).length, duck: d.src === 'duckdb', tbl: d.tbl || r.tbl || null, notes: r.notes || [] };
            if (!P.rep || P.rep.path !== r.path) P.rep = null;
            go('run');
        });
    }
    function runAgain(id) {
        var r = P.runs.filter(function (x) { return x.runId === id; })[0]; if (!r) return;
        var values = {}; Object.keys(r.params || {}).forEach(function (k) { var v = r.params[k]; values[k] = Array.isArray(v) ? (v.length === 1 ? v[0] : v) : v; });
        openReport(r.path, { values: values, format: r.format, template: r.template, bucket: r.buckets > 1 ? { mode: 'date' } : { mode: 'none' } });
    }

    // ── Settings ──────────────────────────────────────────────────
    function vSettings() {
        var st = P.status || {};
        return '<div class="card"><h2>Pod</h2><div class="form"><div class="field"><label>Reports and runs on</label><select id="s-pod"><option ' + (P.pod === 'PROD' ? 'selected' : '') + '>PROD</option><option ' + (P.pod === 'TEST' ? 'selected' : '') + '>TEST</option></select></div><div class="field"><label>Fusion user</label><input type="text" value="' + esc(st.user || '') + '" disabled></div><div class="field"><label>Endpoint</label><input type="text" value="' + esc(st.origin || '') + '" disabled></div></div><div class="muted small" style="margin-top:6px">The host calls /xmlpserver/services/v2/CatalogService and ReportService of that pod with the application\'s Fusion credentials; the page never holds them.</div></div>' +
            '<div class="card"><h2>Runs</h2><div class="form"><div class="field"><label>Chunk size (MB)</label><input type="number" id="s-chunk" min="1" max="200" value="' + esc(P.set.chunkMb) + '"><span class="muted small">a report bigger than this is fetched with downloadReportDataChunk, piece by piece</span></div><div class="field"><label>Time limit per run (min)</label><input type="number" id="s-timeout" min="1" max="360" value="' + esc(P.set.timeoutMin) + '"></div><div class="field"><label>Rows loaded into the page at once</label><input type="number" id="s-rows" min="500" max="50000" step="500" value="' + esc(P.set.rowsAtOnce) + '"><span class="muted small">the whole file stays on disk; the grid loads more on demand</span></div><div class="field"><label>Default date window (days)</label><input type="number" id="s-days" min="1" max="3660" value="' + esc(P.set.dateDefaultDays) + '"><span class="muted small">when a report\'s date parameters are empty</span></div></div><div class="row" style="margin-top:10px"><button class="btn pri" data-act="settingsSave">Save</button><span class="muted small">Runs are kept in ' + esc(st.runsRoot || '%LOCALAPPDATA%\\GraysWMS\\Bip\\runs') + ' (' + esc(st.runs || 0) + ' so far) — delete old ones in History.</span></div></div>' +
            vDuckCard() +
            '<div class="card"><h2>Catalog index</h2><div class="form"><div class="field"><label>Index from</label><input type="text" id="s-root" value="' + esc(P.set.indexRoot || '/') + '" placeholder="/ or /Custom"></div></div><div class="row" style="margin-top:10px"><button class="btn" data-act="index">' + (P.indexing ? 'Indexing… ' + esc(P.indexing) : P.index.at ? 'Re-index now' : 'Index now') + '</button>' + (P.indexing ? '<button class="btn" data-act="indexCancel">Stop</button>' : '') + '<span class="muted small">' + (P.index.at ? P.index.reports + ' reports in ' + P.index.folders + ' folders, indexed ' + esc(P.index.at) : 'Not indexed yet — the search box then finds reports by name anywhere in the catalog.') + '</span></div><div class="muted small" style="margin-top:8px">' + INDEX_HELP + '</div></div>' +
            '<div class="card"><h2>About</h2><div class="small muted">Browse the BI Publisher catalog, read a report\'s parameters and list of values, run it — streamed to disk, in chunks when big, in date or value buckets when long — and keep dashboards of reports in APEX. Big reports: the host never holds the output in memory (XmlReader + base64 streaming), the chunked download takes the rest, and buckets turn one impossible run into many small ones. Output formats come from the report\'s templates. Favourites, notes, dashboards and the run log are shared through APEX (apex_sql/98_bip_reporting.sql).</div></div>';
    }

    var INDEX_HELP = 'How the index works: the host walks the catalog breadth-first from the root with CatalogService.getFolderContents — every folder once, at most 1,500 folders — and records each item (path, name, type, parent folder, modified, owner). The list is kept in this PC\'s DuckDB file (bip_catalog), shared through APEX (WMS_BIP_CATALOG) so every other user gets it at once, and loaded into the page: the search box then matches every word you type against the name and path of every item, reports first. Folders you open one at a time are kept the same way. It is a listing of the catalog, not of report contents; Re-index after reports were added or moved.';
    // ── Explore (SQL over the DuckDB file) ────────────────────────
    var EX_SAMPLES = [
        ['Runs on this PC', "SELECT run_id, name, pod, format, buckets, rows_n, ms, status, started_at, tbl\nFROM bip_runs ORDER BY started_at DESC LIMIT 200"],
        ['Reports run most', "SELECT path, name, COUNT(*) AS runs, SUM(rows_n) AS rows_total, ROUND(AVG(ms)) AS avg_ms\nFROM bip_runs GROUP BY path, name ORDER BY runs DESC LIMIT 50"],
        ['Catalog: reports per folder', "SELECT pod, parent, COUNT(*) AS reports FROM bip_catalog WHERE type = 'Report' GROUP BY pod, parent ORDER BY reports DESC"],
        ['Catalog: find a report', "SELECT pod, name, path, modified, owner FROM bip_catalog WHERE type = 'Report' AND lower(name) LIKE '%aging%' ORDER BY name"],
        ['Definitions kept', "SELECT pod, path, read_at, length(def_json) AS def_chars, length(params_json) AS params_chars FROM bip_report_meta ORDER BY read_at DESC"]
    ];
    function loadTables() {
        return S.bip('bipTables', {}, 60000).then(function (d) { P.explore.tables = d.tables || []; P.explore.duck = d.duck || null; if (P.tab === 'explore') render(); }).catch(function (e) { P.explore.duck = { ok: false, error: e.message }; if (P.tab === 'explore') render(); });
    }
    function vExplore() {
        var X = P.explore, duck = X.duck || (P.status && P.status.duck) || {};
        var h = '<div class="explore"><div>';
        h += '<div class="card"><h2>Result tables <span class="pill">' + X.tables.length + '</span> <button class="btn sm ghost" data-act="refreshTables" title="Read the list again"><i class="fas fa-rotate"></i></button></h2>' +
            (duck.ok === false ? '<div class="badbox">DuckDB is not available: ' + esc(duck.error || '') + '</div>' : '<div class="muted small" style="margin-bottom:6px">Every data run lands here as a table — click one to query it.</div>') +
            '<div class="tlist">' + (X.tables.length ? X.tables.map(function (t) { return '<a data-act="exploreTable" data-tbl="' + esc(t.tbl) + '"><b>' + esc(t.name || t.tbl) + '</b><span class="s">' + esc(t.tbl) + ' · ' + esc(E.fmtNum(t.rows_n || 0)) + ' rows · ' + esc(t.cols || 0) + ' cols · ' + esc(t.started_at || '') + (t.buckets > 1 ? ' · ' + t.buckets + ' buckets' : '') + '</span></a>'; }).join('') : '<div class="muted small">No result kept yet — run a report in a data format.</div>') + '</div>' +
            '<h3>Also in the file</h3><div class="tlist">' + [['bip_runs', 'every run of this PC'], ['bip_catalog', 'the catalog as last read'], ['bip_report_meta', 'definitions + parameters (JSON)'], ['bip_index_log', 'the index walks']].map(function (t) { return '<a data-act="exploreTable" data-tbl="' + t[0] + '"><b>' + t[0] + '</b><span class="s">' + t[1] + '</span></a>'; }).join('') + '</div>' +
            '<h3>Samples</h3><div class="tlist">' + EX_SAMPLES.map(function (x, i) { return '<a data-act="exploreSample" data-i="' + i + '">' + esc(x[0]) + '</a>'; }).join('') + '</div></div>';
        h += '</div><div>';
        h += '<div class="card"><div class="row"><h2 style="margin:0">SQL over the DuckDB file <span class="muted small">read-only · SELECT / WITH / DESCRIBE / SUMMARIZE</span></h2><span class="sp"></span>' + (duck.path ? '<span class="src duck" title="' + esc(duck.path) + '"><i class="fas fa-database"></i> ' + esc(E.fmtBytes(duck.sizeBytes || 0)) + ' · ' + esc(duck.results || 0) + ' results' + (duck.encrypted ? ' · <i class="fas fa-lock"></i>' : '') + '</span>' : '') + '</div>' +
            '<textarea id="ex-sql" rows="7" spellcheck="false" placeholder="SELECT * FROM res_… LIMIT 500">' + esc(X.sql) + '</textarea>' +
            '<div class="row" style="margin-top:8px"><button class="btn pri" data-act="exploreRun" ' + (X.busy ? 'disabled' : '') + '><i class="fas fa-play"></i> Run <span class="muted small" style="color:#fff;opacity:.8">Ctrl+Enter</span></button><button class="btn" data-act="exploreDescribe" title="DESCRIBE the first table named in the SQL"><i class="fas fa-list"></i> Columns</button><button class="btn" data-act="exploreSummarize" title="SUMMARIZE the first table named in the SQL — min / max / distinct / nulls per column"><i class="fas fa-chart-simple"></i> Summarize</button><span class="sp"></span><label class="chk">rows at most <input type="number" id="ex-max" min="100" max="200000" step="100" value="' + esc(ls('explore.max', 20000)) + '" style="width:110px"></label></div></div>';
        if (X.res) {
            var R = X.res;
            h += '<div class="card">' + (R.error ? '<div class="badbox">' + esc(R.error) + '</div>' : '<div class="row" style="margin-bottom:8px"><span class="pill ok">' + esc(E.fmtNum(R.rows.length)) + ' rows' + (R.truncated ? ' (cut at the limit)' : '') + '</span><span class="pill">' + R.columns.length + ' columns</span><span class="pill">' + esc(E.fmtMs(R.ms)) + '</span><span class="sp"></span><button class="btn sm" data-act="exploreChart" title="Chart the result in the Run tab\'s chart view"><i class="fas fa-chart-column"></i> As a result</button></div><div id="ex-grid"></div>') + '</div>';
        } else h += '<div class="card empty">Pick a result table on the left, or type SQL — DuckDB joins results with each other, with the catalog and with the runs.</div>';
        return h + '</div></div>';
    }
    function afterExplore() { var R = P.explore.res; if (R && !R.error && $('ex-grid')) P._exGrid = G.grid($('ex-grid'), { columns: R.columns, rows: R.rows, height: 520, key: 'explore', name: 'query', toast: toast }); }
    function runExplore(sql) {
        var X = P.explore; sql = sql != null ? sql : ($('ex-sql') ? $('ex-sql').value : X.sql);
        X.sql = sql; lsSet('explore.sql', sql);
        var max = +(($('ex-max') || {}).value || ls('explore.max', 20000)) || 20000; lsSet('explore.max', max);
        if (!sql.trim()) { toast('Type a SELECT first', 'warn'); return Promise.resolve(); }
        X.busy = true;
        return run('Running the query…', function () { return S.bip('bipQuery', { sql: sql, max: max }, 600000); }).then(function (d) {
            var cols = d.columns || [];
            X.res = { columns: cols, rows: (d.rows || []).map(function (r) { if (!Array.isArray(r)) return r; var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o; }), truncated: !!d.truncated, ms: d.ms || 0, sql: sql };
        }).catch(function (e) { X.res = { error: e.message, columns: [], rows: [], sql: sql }; }).then(function () { X.busy = false; if (P.tab === 'explore') render(); });
    }
    function firstTableOf(sql) { var m = /\bfrom\s+([A-Za-z_][\w.]*)/i.exec(sql || ''); return m ? m[1] : null; }

    function vDuckCard() {
        var d = (P.status && P.status.duck) || {};
        return '<div class="card"><h2><i class="fas fa-database"></i> DuckDB on this PC</h2>' + (d.ok === false ? '<div class="badbox">' + esc(d.error || 'not available') + '<div class="small">' + esc(d.path || '') + '</div></div>' :
            '<div class="kv"><span class="k">File</span><span class="mono">' + esc(d.path || '') + '</span><span class="k">Size</span><span>' + esc(E.fmtBytes(d.sizeBytes || 0)) + '</span><span class="k">Holds</span><span>' + esc(E.fmtNum(d.results || 0)) + ' result tables · ' + esc(E.fmtNum(d.catalogRows || 0)) + ' catalog items · ' + esc(E.fmtNum(d.runs || 0)) + ' runs</span><span class="k">Encryption</span><span>' + (d.encrypted ? '<i class="fas fa-lock"></i> AES-256 (key on this PC)' : 'not encrypted yet' + (d.cryptoNote ? ' — ' + esc(d.cryptoNote) : '')) + '</span></div>') +
            '<div class="muted small" style="margin:8px 0">The catalog (as last read or indexed), every report\'s definition and parameters, and the rows of every data run (tables res_…) live here, so folders, forms and results open without asking Fusion; the Explore tab queries them with SQL. The catalog is also shared through APEX (WMS_BIP_CATALOG) so other users get it at once.</div>' +
            '<div class="row"><button class="btn" data-act="duckClear" data-what="results"><i class="fas fa-broom"></i> Clear the results</button><button class="btn" data-act="duckClear" data-what="catalog">Clear the catalog + definitions</button><button class="btn ghost" data-act="duckClear" data-what="all">Clear everything</button><span class="muted small">AI admins only · the run files under History stay</span></div></div>';
    }

    // ── drawer ────────────────────────────────────────────────────
    function drawer(o) { closeDrawer(); P.drawer = { state: o.state || {} }; var bg = document.createElement('div'); bg.className = 'drawer-bg'; bg.id = 'drawer-bg'; bg.setAttribute('data-act', 'drawerClose'); var d = document.createElement('div'); d.className = 'drawer'; d.id = 'drawer'; d.innerHTML = '<div class="dh"><div class="t">' + o.title + '</div><span class="sp"></span><button class="btn sm ghost" data-act="drawerClose">✕</button></div><div class="db">' + o.html + '</div><div class="df">' + (o.foot || '') + '</div>'; document.body.appendChild(bg); document.body.appendChild(d); }
    function closeDrawer() { ['drawer', 'drawer-bg'].forEach(function (id) { var el = $(id); if (el) el.parentNode.removeChild(el); }); P.drawer = null; }
    function notesDialog() {
        var r = P.rep, n = r.note || {};
        drawer({ title: 'Notes · ' + r.name, html: '<div class="form"><div class="field wide"><label>Tags (short, comma separated)</label><input type="text" id="n-tags" value="' + esc(n.T || '') + '" placeholder="finance, month-end, slow"></div><div class="field wide"><label>Notes for everyone who opens this report</label><textarea id="n-notes" rows="8">' + esc(n.N || '') + '</textarea></div>' + (n.CHANGED_BY ? '<div class="muted small wide">last changed by ' + esc(n.CHANGED_BY) + ' · ' + esc(n.AT) + '</div>' : '') + '</div>', foot: '<button class="btn" data-act="drawerClose">Cancel</button><span class="sp"></span><button class="btn pri" data-act="notesSave">Save</button>' });
    }

    // ── events ────────────────────────────────────────────────────
    var ACT = {
        pod: function () { P.pod = P.pod === 'PROD' ? 'TEST' : 'PROD'; lsSet('pod', P.pod); P.cat.cache = {}; P.index = { items: null }; P.rep = null; P.result = null; P.dash = null; P.dashes = []; P.dashRes = {}; P.explore.res = null; paintWho(); S.bip('bipStatus', { instance: P.pod }).then(function (st) { P.status = st; if (st.index) { P.index.at = st.index.at; P.index.folders = st.index.folders; P.index.reports = st.index.reports; } paintWho(); render(); }).catch(function () { }); loadShared(); loadFolder(P.cat.path, true); toast('Now on ' + P.pod, 'ok'); },
        cd: function (d) { P.cat.q = ''; go('catalog'); loadFolder(d.path); },
        refreshFolder: function () { loadFolder(P.cat.path, true); },
        index: function () { ensureIndex().then(indexCatalog, indexCatalog); },
        indexCancel: function () { S.bip('bipIndexCancel', { instance: P.pod }).catch(function () { }); },
        open: function (d) { openReport(d.path); },
        none: function () { },
        fav: function (d, el) { var on = isFav(d.path); (on ? S.fav.remove(P.pod, d.path) : S.fav.add(P.pod, d.path, d.name || nameOf(d.path))).then(function () { return S.fav.list(P.pod); }).then(function (f) { P.favs = f; document.querySelectorAll('.star[data-path="' + CSS.escape(d.path) + '"]').forEach(function (s) { s.classList.toggle('on', !on); }); if (P.tab === 'catalog') render(); }).catch(function (e) { toast(e.message, 'bad'); }); },
        sql: function (d) { showSql(d.path); },
        sqlClose: function () { if (P.rep) P.rep.sql = null; render(); },
        sqlCopy: function (d) { var m = (P.rep && P.rep.sql) || (P.drawer && P.drawer.state.sql); if (m) navigator.clipboard.writeText(m.model.dataSets[+d.i].sql).then(function () { toast('SQL copied', 'ok'); }); },
        sqlFusion: function (d) { toFusionSql(d.i); },
        notes: function () { notesDialog(); },
        notesSave: function () { var r = P.rep; S.notes.save(P.pod, r.path, $('n-notes').value.trim(), $('n-tags').value.trim()).then(function () { return S.notes.get(P.pod, r.path); }).then(function (n) { r.note = n; P.notes[r.path] = { P: r.path, N: n && n.N, T: n && n.T }; closeDrawer(); render(); toast('Notes saved', 'ok'); }).catch(function (e) { toast(e.message, 'bad'); }); },
        run: function () { startRun(); },
        cancel: function () { if (P.running && P.running.runId) S.bip('bipCancel', { runId: P.running.runId }).catch(function () { }); else toast('Stopping as soon as the run has an id…', 'warn'); },
        preview: function () { readForm(); var r = P.rep; S.bip('bipPreview', { instance: P.pod, path: r.path, format: r.format, template: r.template || null, params: E.encode(r.params, r.values), chunkBytes: Math.round((P.set.chunkMb || 8) * 1000000) }).then(function (d) { drawer({ title: 'SOAP request · runReport', html: '<div class="muted small">POST ' + esc((P.status || {}).origin || '') + '/xmlpserver/services/v2/ReportService · SOAPAction "runReport" · the password is masked. Paste it into SoapUI to reproduce a run.</div><pre class="code" style="max-height:70vh">' + esc(d.envelope) + '</pre>', foot: '<button class="btn" data-act="drawerClose">Close</button><span class="sp"></span><button class="btn" data-act="copyEnvelope">Copy</button>', state: { envelope: d.envelope } }); }).catch(function (e) { toast(e.message, 'bad'); }); },
        copyEnvelope: function () { navigator.clipboard.writeText(P.drawer.state.envelope).then(function () { toast('Copied', 'ok'); }); },
        resView: function (d) { P.resView = d.v; lsSet('resView', d.v); render(); },
        more: function () { loadMore(); },
        excel: function () { exportExcel(); },
        copy: function () { var R = P.result; var tsv = R.columns.join('\t') + '\n' + R.rows.map(function (r) { return R.columns.map(function (c) { return r[c] == null ? '' : String(r[c]).replace(/\t|\n/g, ' '); }).join('\t'); }).join('\n'); navigator.clipboard.writeText(tsv).then(function () { toast(E.fmtNum(R.rows.length) + ' rows copied — paste into Excel', 'ok'); }); },
        saveAs: function () { var R = P.result; S.bip('bipRunSaveAs', { runId: R.runId, file: R.file, fileName: R.name + '.' + (R.file.split('.').pop()) }, 0).then(function (d) { if (d.path) toast('Saved · ' + d.path, 'ok', 6000); }).catch(function (e) { toast(e.message, 'bad'); }); },
        openFile: function () { var R = P.result; S.bip('bipRunOpen', { runId: R.runId, file: R.file }).catch(function (e) { toast(e.message, 'bad'); }); },
        folder: function () { S.bip('bipRunFolder', { runId: P.result.runId }).catch(function (e) { toast(e.message, 'bad'); }); },
        closeResult: function () { P.result = null; render(); },
        retryFailed: function () { var R = P.result, r = P.rep; if (!r || r.path !== R.path) { toast('Open the report first', 'warn'); return; } readForm(); var plan = planOf().filter(function (b) { return R.failed.some(function (f) { return f.label === b.label; }); }); if (!plan.length) { toast('The failed buckets are not in the current plan', 'warn'); return; } P.running = { name: r.name, path: r.path, phase: 'starting', bucket: 1, buckets: plan.length, bytes: 0, rows: 0, ms: 0, t0: Date.now() }; P.result = null; render(); var params = E.encode(r.params, r.values); S.bip('bipRun', { instance: P.pod, path: r.path, name: r.name + ' (retry)', format: r.format, template: r.template || null, params: params, buckets: plan, chunkBytes: Math.round((P.set.chunkMb || 8) * 1000000), timeoutMs: Math.round((P.set.timeoutMin || 20) * 60000), sample: P.set.rowsAtOnce || 20000 }, 0, function (pr) { if (P.running) { Object.assign(P.running, pr); P.running.ms = Date.now() - P.running.t0; var el = document.querySelector('.progress'); if (el) el.outerHTML = vProgress(); } }).then(function (d) { onRunDone(d, r, plan.length, params); }).catch(function (e) { P.running = null; toast(e.message, 'bad'); render(); }); },
        refreshDef: function () { if (P.rep) openReport(P.rep.path, { values: P.rep.values, format: P.rep.format, template: P.rep.template, bucket: P.rep.bucket }, true); },
        indexHelp: function () { drawer({ title: 'The catalog index', html: '<div class="card">' + INDEX_HELP + '</div>', foot: '<button class="btn" data-act="drawerClose">Close</button>' }); },
        exploreRes: function (d) { P.explore.sql = 'SELECT * FROM ' + d.tbl + ' LIMIT 500'; lsSet('explore.sql', P.explore.sql); go('explore'); runExplore(P.explore.sql); },
        exploreTable: function (d) { P.explore.sql = 'SELECT * FROM ' + d.tbl + ' LIMIT 500'; lsSet('explore.sql', P.explore.sql); runExplore(P.explore.sql); },
        exploreSample: function (d) { P.explore.sql = EX_SAMPLES[+d.i][1]; lsSet('explore.sql', P.explore.sql); runExplore(P.explore.sql); },
        exploreRun: function () { runExplore(); },
        exploreDescribe: function () { var t = firstTableOf(($('ex-sql') || {}).value || P.explore.sql); if (!t) { toast('Name a table in the SQL first (FROM …)', 'warn'); return; } P.explore.sql = ($('ex-sql') || {}).value || P.explore.sql; runExplore('DESCRIBE ' + t).then(function () { }); },
        exploreSummarize: function () { var t = firstTableOf(($('ex-sql') || {}).value || P.explore.sql); if (!t) { toast('Name a table in the SQL first (FROM …)', 'warn'); return; } runExplore('SUMMARIZE ' + t); },
        exploreChart: function () { var R = P.explore.res; if (!R || R.error) return; P.result = { runId: 'query', pod: P.pod, path: 'explore', name: 'SQL result', format: 'csv', file: '', files: [], columns: R.columns, rows: R.rows, total: R.rows.length, loaded: R.rows.length, bytes: 0, ms: R.ms, buckets: 0, done: 1, failed: [], status: 'DONE', duck: false, notes: ['From the Explore tab: ' + R.sql.slice(0, 200)] }; P.resView = 'chart'; go('run'); },
        refreshTables: function () { loadTables(); },
        duckClear: function (d) { if (!confirm('Clear ' + (d.what === 'all' ? 'everything' : 'the ' + d.what) + ' from the DuckDB file on this PC?')) return; run('Clearing…', function () { return S.bip('bipDuckClear', { what: d.what }, 300000); }).then(function (x) { toast('Cleared (' + (x.n || 0) + ')', 'ok'); if (d.what !== 'results') { P.cat.cache = {}; P.index = { items: null }; } return S.bip('bipStatus', { instance: P.pod }).then(function (st) { P.status = st; render(); }); }).catch(function () { }); },
        addCard: function (d) { addCardDialog(d.path, d.name || nameOf(d.path), !!(P.rep && P.rep.path === d.path && P.tab === 'run')); },
        addCardGo: function () { addCardGo(); },
        dashNew: function () { var name = prompt('Name of the new dashboard:', 'My reports'); if (!name) return; var d = { id: uid('d'), name: name, pod: P.pod, shared: true, cards: [], refreshMin: 0 }; P.dash = d; lsSet('dash', d.id); saveDash(d); },
        dashEdit: function () { var d = P.dash; var name = prompt('Dashboard name:', d.name); if (name == null) return; d.name = name.trim() || d.name; d.shared = confirm('Share it with everyone? (Cancel = only you)'); saveDash(d); },
        dashDelete: function () { if (!P.dash || !confirm('Delete dashboard ' + P.dash.name + '?')) return; var id = P.dash.id; run('Deleting…', function () { return S.dash.del(id); }).then(function () { P.dash = null; return loadDashes(); }); },
        dashRunAll: function () { runAll(); },
        dashExport: function () { var blob = new Blob([JSON.stringify(P.dash, null, 2)], { type: 'application/json' }); if (window.saveAs) saveAs(blob, P.dash.name + '.bipdash.json'); else { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = P.dash.name + '.bipdash.json'; a.click(); } },
        dashImport: function () { var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'; inp.onchange = function () { var f = inp.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { try { var d = JSON.parse(String(rd.result)); if (!d || !d.cards) throw new Error('not a dashboard file'); d.id = uid('d'); d.pod = P.pod; d.cards.forEach(function (c) { c.id = uid('c'); }); P.dash = d; lsSet('dash', d.id); saveDash(d).then(function () { toast('Imported ' + d.name, 'ok'); }); } catch (e) { toast('Cannot import: ' + e.message, 'bad'); } }; rd.readAsText(f); }; inp.click(); },
        cardRun: function (d) { var c = P.dash.cards.filter(function (x) { return x.id === d.id; })[0]; if (c) runCard(c); },
        cardOpen: function (d) { var c = P.dash.cards.filter(function (x) { return x.id === d.id; })[0]; if (c) openReport(c.path, { values: c.values, format: c.format, template: c.template, bucket: c.bucket }); },
        cardEdit: function (d) { var c = P.dash.cards.filter(function (x) { return x.id === d.id; })[0]; if (c) cardEdit(c); },
        cardEditSave: function () { cardEditSave(); },
        cardLeft: function (d) { var i = P.dash.cards.findIndex(function (x) { return x.id === d.id; }); if (i > 0) { var t = P.dash.cards[i - 1]; P.dash.cards[i - 1] = P.dash.cards[i]; P.dash.cards[i] = t; saveDash(P.dash); } },
        cardRight: function (d) { var i = P.dash.cards.findIndex(function (x) { return x.id === d.id; }); if (i >= 0 && i < P.dash.cards.length - 1) { var t = P.dash.cards[i + 1]; P.dash.cards[i + 1] = P.dash.cards[i]; P.dash.cards[i] = t; saveDash(P.dash); } },
        cardRemove: function (d) { if (!confirm('Remove this card?')) return; P.dash.cards = P.dash.cards.filter(function (x) { return x.id !== d.id; }); saveDash(P.dash); },
        reloadRuns: function () { loadRuns(); },
        exploreOpen: function () { go('explore'); },
        runsFolder: function () { S.bip('bipRunFolder', {}).catch(function (e) { toast(e.message, 'bad'); }); },
        runOpenResult: function (d) { openRunResult(d.id); },
        runOpenFile: function (d) { S.bip('bipRunOpen', { runId: d.id }).catch(function (e) { toast(e.message, 'bad'); }); },
        runAgain: function (d) { runAgain(d.id); },
        runSaveAs: function (d) { var r = P.runs.filter(function (x) { return x.runId === d.id; })[0]; S.bip('bipRunSaveAs', { runId: d.id, file: r && r.file, fileName: r ? r.name + '.' + String(r.file).split('.').pop() : null }, 0).then(function (x) { if (x.path) toast('Saved · ' + x.path, 'ok', 6000); }).catch(function (e) { toast(e.message, 'bad'); }); },
        runDelete: function (d) { if (!confirm('Delete this run and its files?')) return; S.bip('bipRunDelete', { runId: d.id }).then(loadRuns).catch(function (e) { toast(e.message, 'bad'); }); },
        settingsSave: function () { P.set.chunkMb = +$('s-chunk').value || 8; P.set.timeoutMin = +$('s-timeout').value || 20; P.set.rowsAtOnce = +$('s-rows').value || 20000; P.set.dateDefaultDays = +$('s-days').value || 30; P.set.indexRoot = $('s-root').value.trim() || '/'; lsSet('set', P.set); var pod = $('s-pod').value; if (pod !== P.pod) ACT.pod(); else toast('Saved', 'ok'); },
        drawerClose: function () { closeDrawer(); }
    };
    function onClick(e) {
        var el = e.target.closest('[data-act]'); if (!el) return;
        if (el.id === 'drawer-bg' && e.target !== el) return;
        var act = el.dataset.act; if (!ACT[act]) return;
        e.preventDefault();
        try { ACT[act](el.dataset, el); } catch (x) { console.error(x); toast(x.message, 'bad'); }
    }
    function onChange(e) {
        var t = e.target;
        if (t.id === 'b-mode' || t.id === 'b-by' || t.id === 'b-from' || t.id === 'b-to' || t.id === 'b-vparam' || t.id === 'b-values' || t.id === 'b-n' || (t.classList.contains('pv') && t.type === 'date')) { readForm(); render(); }
        else if (t.id === 'r-format') { readForm(); render(); }
        else if (t.id === 'r-template') readForm();
        else if (t.id === 'c-x' || t.id === 'c-y' || t.id === 'c-fn' || t.id === 'c-type' || t.id === 'c-top') { P.chart = { x: $('c-x').value, y: $('c-y').value, fn: $('c-fn').value, type: $('c-type').value, top: +$('c-top').value || 20 }; lsSet('chart', P.chart); render(); }
        else if (t.id === 'd-pick') { if (t.value) openDash(t.value); }
        else if (t.id === 'd-refresh') { P.dash.refreshMin = +t.value || 0; saveDash(P.dash); scheduleDash(); }
        else if (t.id === 'ac-dash') { var nb = $('ac-newbox'); if (nb) nb.style.display = t.value === '__new' ? '' : 'none'; }
    }
    function onInput(e) {
        var t = e.target;
        if (t.id === 'cat-q') { P.cat.q = t.value; clearTimeout(onInput.t); onInput.t = setTimeout(function () { ensureIndex().then(render, render); }, 250); }
    }
    document.addEventListener('DOMContentLoaded', boot);
})();

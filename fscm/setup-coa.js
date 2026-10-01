/* Setup & Diagnostics — COA Segments: values of each chart-of-accounts value set (valueSets/{code}/child/values,
   every page). The segment list is editable (stored on this PC) and can be extended by searching the pod's value sets.
   The values are cached in the page and reused by the Trial Balance check and the BIP "Get account description". */

var SetCoa = { cache: {}, open: [], active: null, q: {} };

// Fixed from the source: Activity_Details pointed at "Analysis Details VS" (duplicate of Analysis_Details).
SetCoa.DEFAULTS = [
    ['coa-company', 'Company', 'Company_VS'], ['coa-main-account', 'Main Account', 'Main Account VS'], ['coa-sub-account', 'Sub Account', 'Sub Account VS'],
    ['coa-division', 'Division', 'Division VS'], ['coa-department', 'Department', 'Department VS'], ['coa-lob', 'LOB', 'LOB'],
    ['coa-activity-type', 'Activity Type', 'Activity Type VS'], ['coa-activity-details', 'Activity Details', 'Activity Details VS'],
    ['coa-analysis-type', 'Analysis Type', 'Analysis Type VS'], ['coa-analysis-details', 'Analysis Details', 'Analysis Details VS'],
    ['coa-ic', 'IC', 'IC VS'], ['coa-emp', 'Emp', 'Emp VS'], ['coa-future-1', 'Future 1', 'Future 1'], ['coa-future-2', 'Future 2', 'Future 2'], ['coa-future-3', 'Future 3', 'Future 3']
].map(function (a) { return { key: a[0], label: a[1], valueSet: a[2] }; });

SetCoa.segments = function () { var s = lsGet('set_coa_segments', null); return Array.isArray(s) && s.length ? s : SetCoa.DEFAULTS; };
SetCoa.seg = function (key) { return SetCoa.segments().filter(function (s) { return s.key === key; })[0]; };
/** The natural-account segment (for "Get account description"). */
SetCoa.accountSeg = function () { return SetCoa.segments().filter(function (s) { return /main\s*_?account|natural/i.test(s.label + ' ' + s.valueSet); })[0] || SetCoa.segments().filter(function (s) { return /account/i.test(s.label); })[0]; };
SetCoa.path = function (vs) { return 'valueSets/' + encodeURIComponent(vs) + '/child/values'; };
SetCoa.desc = function (r) { return r.Description || r.ValueDescription || r.MeaningDescription || ''; };

/** All values of one value set (cached per pod). Falls back to the numeric ValueSetId when the code is not accepted as key. */
SetCoa.values = function (vs, force, onPage) {
    var k = FX.instance + '|' + vs;
    if (force) delete SetCoa.cache[k];
    if (!SetCoa.cache[k]) {
        var c = SetCoa.cache[k] = { p: null, rows: null, fetched: null, url: SU.root() + SetCoa.path(vs) };
        c.p = FX.restAll(SetCoa.path(vs), { limit: 500 }, 200000, onPage).catch(function (e) {
            if (!/404|not found/i.test(String(e))) throw e;
            return FX.get('valueSets', { q: 'ValueSetCode=' + FX.qv(vs), limit: 1 }).then(function (j) {
                var it = (j.items || [])[0]; if (!it || it.ValueSetId == null) throw 'Value set "' + vs + '" was not found on ' + FX.instance + '.';
                c.url = SU.root() + 'valueSets/' + it.ValueSetId + '/child/values';
                return FX.restAll('valueSets/' + it.ValueSetId + '/child/values', { limit: 500 }, 200000, onPage);
            });
        }).then(function (rows) { c.rows = rows.map(function (r) { var y = Object.assign({}, r); delete y.links; return y; }); c.fetched = new Date(); return c.rows; })
            .catch(function (e) { delete SetCoa.cache[k]; throw e; });
    }
    return SetCoa.cache[k].p;
};
SetCoa.cached = function (vs) { var c = SetCoa.cache[FX.instance + '|' + vs]; return c && c.rows ? c : null; };

// ── view ───────────────────────────────────────────────────────
SetCoa.render = function (el) {
    SU.headRight('<button class="btn sm" id="sc-edit"><i class="fa-solid fa-pen"></i> Segment list</button>');
    $('sc-edit').onclick = SetCoa.editList;
    var segs = SetCoa.segments();
    el.innerHTML = '<div class="su-split"><div class="card su-side"><div class="card-h"><b><i class="fa-solid fa-sitemap"></i> Segments</b></div><div id="sc-list"></div></div>' +
        '<div class="su-main"><div id="sc-tabs"></div><div id="sc-body" class="su-fill"></div></div></div>';
    $('sc-list').innerHTML = segs.map(function (s) {
        var c = SetCoa.cached(s.valueSet);
        return '<button class="su-li' + (SetCoa.active === s.key ? ' on' : '') + '" data-scseg="' + esc(s.key) + '"><span><b>' + esc(s.label) + '</b><small class="mono">' + esc(s.valueSet) + '</small></span>' + (c ? '<span class="su-badge">' + c.rows.length + '</span>' : '') + '</button>';
    }).join('');
    $('sc-list').onclick = function (e) { var b = e.target.closest('[data-scseg]'); if (b) SetCoa.openSeg(b.getAttribute('data-scseg')); };
    $('sc-tabs').onclick = function (e) {
        var x = e.target.closest('[data-suclose]');
        if (x) { var k = x.getAttribute('data-suclose'); SetCoa.open = SetCoa.open.filter(function (o) { return o !== k; }); if (SetCoa.active === k) SetCoa.active = SetCoa.open[SetCoa.open.length - 1] || null; SetCoa.render(el); return; }
        var b = e.target.closest('[data-sutab]'); if (b) { SetCoa.active = b.getAttribute('data-sutab'); SetCoa.render(el); }
    };
    SetCoa.open = SetCoa.open.filter(function (k) { return SetCoa.seg(k); });
    if (!SetCoa.open.length) { $('sc-body').innerHTML = '<div class="card">' + SU.empty('fa-folder-open', 'No segments open', 'Click a segment on the left to open its values as a tab.') + '</div>'; return; }
    $('sc-tabs').innerHTML = SU.tabBar(SetCoa.open.map(function (k) { var s = SetCoa.seg(k), c = SetCoa.cached(s.valueSet); return { id: k, label: s.label, badge: c ? c.rows.length : '', closable: true }; }), SetCoa.active);
    SetCoa.drawSeg($('sc-body'), SetCoa.seg(SetCoa.active), false);
};
SetCoa.openSeg = function (key) {
    if (SetCoa.open.indexOf(key) < 0) SetCoa.open.push(key);
    SetCoa.active = key; SetCoa.render($('fx-view'));
};
SetCoa.drawSeg = function (body, s, force) {
    var c = !force && SetCoa.cached(s.valueSet);
    if (!c) {
        body.innerHTML = '<div class="card">' + SU.loading('Reading ' + s.valueSet + '…') + '</div>';
        SetCoa.values(s.valueSet, force, function (n) { var sp = body.querySelector('.su-empty span'); if (sp) sp.textContent = 'Reading ' + s.valueSet + '… ' + n + ' values'; }).then(function (rows) {
            FX.toast(s.label + ': ' + (force ? 'refreshed ' : '') + rows.length + ' values loaded.', 'ok');
            if (FX.cur && FX.cur.id === 'coa' && SetCoa.active === s.key) SetCoa.render($('fx-view'));
        }).catch(function (e) { if (SetCoa.active === s.key && document.body.contains(body)) body.innerHTML = '<div class="card pad">' + SU.err(e) + '<div class="row-btns" style="margin-top:8px"><button class="btn sm" id="sc-retry"><i class="fa-solid fa-rotate"></i> Retry</button></div></div>'; if ($('sc-retry')) $('sc-retry').onclick = function () { SetCoa.drawSeg(body, s, true); }; });
        return;
    }
    var en = c.rows.filter(function (r) { return r.EnabledFlag === 'Y' || r.EnabledFlag === true; }).length;
    body.innerHTML = '<div class="card su-info"><div><span>Segment</span><b>' + esc(s.label) + '</b></div><div><span>Value set</span><b class="mono">' + esc(s.valueSet) + '</b></div>' +
        '<div class="grow"><span>Request</span><code class="su-code">' + esc(c.url) + '</code></div><div><span>Fetched</span><b>' + esc(c.fetched.toLocaleTimeString()) + '</b></div>' +
        '<div class="row-btns"><button class="btn sm" id="sc-ref"><i class="fa-solid fa-rotate"></i> Refresh</button><button class="btn sm" id="sc-x"><i class="fa-solid fa-file-excel"></i> Export Excel</button></div></div>' +
        '<div class="kpis">' + SU.kpi(c.rows.length.toLocaleString(), 'Values', 'acc') + SU.kpi(en.toLocaleString(), 'Enabled', 'ok') + SU.kpi((c.rows.length - en).toLocaleString(), 'Disabled') + '</div>' +
        '<div class="card su-fill" id="sc-grid"></div>';
    $('sc-ref').onclick = function () { SetCoa.drawSeg(body, s, true); };
    $('sc-x').onclick = function () {
        var keys = []; c.rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
        SU.xlsx('COA_' + SU.safeFile(s.label) + '_' + FX.today(), [{ name: s.label, aoa: SU.aoa(c.rows, keys.map(function (k) { return { label: k, get: function (r) { var v = r[k]; return v != null && typeof v === 'object' ? JSON.stringify(v) : v; } }; })) }]);
    };
    SU.table($('sc-grid'), {
        rows: c.rows, pageSize: 100, sizes: [50, 100, 200, 500], quickPh: 'Search value or description…', sort: { k: 'Value', d: 1 },
        columns: [
            { k: 'Value', label: 'Value', html: function (r) { return '<b class="mono">' + esc(r.Value) + '</b>'; } },
            { k: 'desc', label: 'Description', get: SetCoa.desc },
            { k: 'EnabledFlag', label: 'Enabled', html: function (r) { return r.EnabledFlag === 'Y' || r.EnabledFlag === true ? '<span class="chip ok">Yes</span>' : '<span class="chip">No</span>'; } },
            { k: 'SummaryFlag', label: 'Parent', html: function (r) { return r.SummaryFlag === 'Y' || r.SummaryFlag === true ? '<span class="chip info">Parent</span>' : ''; } },
            { k: 'StartDateActive', label: 'Start Date', html: function (r) { return r.StartDateActive ? SU.dateGB(r.StartDateActive) : ''; } },
            { k: 'EndDateActive', label: 'End Date', html: function (r) { return r.EndDateActive ? SU.dateGB(r.EndDateActive) : ''; } }
        ],
        onRow: function (r) { FX.json(s.label + ' ' + r.Value, r); }
    });
};

/** Edit the segment list (stored per PC) + search the pod's value sets. */
SetCoa.editList = function () {
    var segs = SetCoa.segments().map(function (s) { return Object.assign({}, s); });
    function rowsHtml() {
        return '<table class="tbl"><thead><tr><th>Label</th><th>Value set code</th><th></th></tr></thead><tbody>' + segs.map(function (s, i) {
            return '<tr><td><input data-sci="' + i + '" data-f="label" value="' + esc(s.label) + '"></td><td><input class="mono" data-sci="' + i + '" data-f="valueSet" value="' + esc(s.valueSet) + '"></td><td><button class="btn sm danger" data-mact="del' + i + '"><i class="fa-solid fa-trash"></i></button></td></tr>';
        }).join('') + '</tbody></table>';
    }
    FX.modal({
        title: '<i class="fa-solid fa-sitemap"></i> Chart of accounts segments', wide: true,
        body: '<div class="note">These value sets are specific to your chart of accounts. The list is kept on this PC and used by COA Segments, the Trial Balance check and the BIP account description.</div>' +
            '<div id="sc-rows">' + rowsHtml() + '</div>' +
            '<div class="su-row"><input class="su-in grow" id="sc-find" placeholder="Search the pod\'s value sets by code, e.g. ACCOUNT"><button class="btn sm" data-mact="find"><i class="fa-solid fa-magnifying-glass"></i> Search</button><button class="btn sm" data-mact="add"><i class="fa-solid fa-plus"></i> Empty row</button></div><div id="sc-found"></div>',
        buttons: [{ label: 'Reset to defaults', act: 'reset' }, { label: 'Cancel', act: 'close' }, { label: 'Save', cls: 'primary', act: 'save' }],
        onAction: function (a, box) {
            Array.prototype.forEach.call(box.querySelectorAll('[data-sci]'), function (inp) { var s = segs[+inp.getAttribute('data-sci')]; if (s) s[inp.getAttribute('data-f')] = inp.value.trim(); });
            if (/^del/.test(a)) { segs.splice(+a.slice(3), 1); $('sc-rows').innerHTML = rowsHtml(); return false; }
            if (a === 'add') { segs.push({ key: 'coa-' + Date.now(), label: '', valueSet: '' }); $('sc-rows').innerHTML = rowsHtml(); return false; }
            if (/^pick/.test(a)) { var it = SetCoa._found[+a.slice(4)]; segs.push({ key: 'coa-' + Date.now(), label: SU.humanize(String(it.ValueSetCode).replace(/[_ ]?VS$/i, '')), valueSet: it.ValueSetCode }); $('sc-rows').innerHTML = rowsHtml(); return false; }
            if (a === 'find') {
                var q = $('sc-find').value.trim(); if (!q) return false;
                $('sc-found').innerHTML = SU.loading('Searching value sets…');
                FX.restAll('valueSets', { q: FX.like('ValueSetCode', q), limit: 100 }, 200).then(function (r) {
                    SetCoa._found = r;
                    $('sc-found').innerHTML = r.length ? '<div class="su-chips">' + r.map(function (it, i) { return '<button class="btn sm" data-mact="pick' + i + '" title="' + esc(it.Description || '') + '"><i class="fa-solid fa-plus"></i> ' + esc(it.ValueSetCode) + '</button>'; }).join('') + '</div>' : '<div class="note">No value set matches.</div>';
                }).catch(function (e) { $('sc-found').innerHTML = SU.err(e); });
                return false;
            }
            if (a === 'reset') { segs = SetCoa.DEFAULTS.map(function (s) { return Object.assign({}, s); }); $('sc-rows').innerHTML = rowsHtml(); return false; }
            if (a === 'save') {
                segs = segs.filter(function (s) { return s.label && s.valueSet; });
                if (!segs.length) { FX.toast('Keep at least one segment.', 'err'); return false; }
                lsSet('set_coa_segments', segs); FX.toast('Segment list saved on this PC.', 'ok');
                if (FX.cur && FX.cur.id === 'coa') SetCoa.render($('fx-view'));
            }
        }
    });
};

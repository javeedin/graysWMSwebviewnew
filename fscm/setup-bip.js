/* Setup & Diagnostics — UAT Diagnostics: run the BI Publisher diagnostic reports kept under /Custom/UAT_disanostic_SCRIPTS/
   through the host (action omBip — the Fusion login stays in the app), show the data as a grid, drill down by ID
   columns, add account descriptions from the COA cache and export to Excel. Re-fetch refreshes the same tab. */

var SetBip = { tabs: [], active: null, seq: 0 };
SetBip.BASE = '/Custom/UAT_disanostic_SCRIPTS/';   // folder name as created on the pod (sic)
SetBip.ID_RE = /(_ID|_NUMBER|_KEY|_BATCH|_HDR|_HEADER|_LINE|_SEQ|BATCH_ID|JE_BATCH|JE_HEADER|HEADER_ID|LINE_ID)$/i;
SetBip.ACCT_RES = [/ACCOUNT/i, /ACCT/i, /SEGMENT4/i, /SEG4/i, /COA/i, /NATURAL_ACCOUNT/i];

SetBip.recent = function () { return lsGet('set_bip_recent', []); };
SetBip.remember = function (file, params) {
    var r = SetBip.recent().filter(function (x) { return x.file !== file; });
    r.unshift({ file: file, params: params || '' }); lsSet('set_bip_recent', r.slice(0, 12));
};
SetBip.parseParams = function (txt) {
    var o = {}; String(txt || '').split(/\r?\n|;/).forEach(function (l) { var m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) o[m[1]] = m[2]; });
    return o;
};

SetBip.render = function (el) {
    SU.headRight('<button class="btn sm primary" id="sbp-new"><i class="fa-solid fa-plus"></i> New report</button>');
    $('sbp-new').onclick = SetBip.newDialog;
    if (!SetBip.tabs.length) {
        var rec = SetBip.recent();
        el.innerHTML = '<div class="card pad"><div class="su-row"><div class="su-ic"><i class="fa-solid fa-stethoscope"></i></div><div class="grow"><b>Oracle BIP diagnostic reports</b>' +
            '<div class="muted" style="font-size:.8rem">Runs a report from <span class="mono">' + esc(SetBip.BASE) + '</span> on ' + esc(FX.instance) + ' with the app\'s Fusion login and shows its rows. ID columns drill down; account columns can get their descriptions from COA Segments.</div></div>' +
            '<button class="btn primary" id="sbp-new2"><i class="fa-solid fa-play"></i> Run a report</button></div></div>' +
            (rec.length ? '<div class="card"><div class="card-h"><b><i class="fa-solid fa-clock-rotate-left"></i> Recent reports</b></div><div class="su-list">' + rec.map(function (r, i) {
                return '<button class="su-li" data-sbprec="' + i + '"><span><b>' + esc(r.file.replace(/\.xdo$/i, '')) + '</b><small class="mono">' + esc(SetBip.BASE + r.file) + (r.params ? ' · ' + esc(r.params.replace(/\n/g, '; ')) : '') + '</small></span><i class="fa-solid fa-play muted"></i></button>';
            }).join('') + '</div></div>' : '') +
            '<div class="card">' + SU.empty('fa-file-waveform', 'No report open', 'Use “New report” and enter the report file name, e.g. PO_Check.xdo.') + '</div>';
        $('sbp-new2').onclick = SetBip.newDialog;
        el.onclick = function (e) { var b = e.target.closest('[data-sbprec]'); if (b) { var r = SetBip.recent()[+b.getAttribute('data-sbprec')]; SetBip.add(r.file, r.params); } };
        return;
    }
    el.onclick = null;
    var tabs = SetBip.tabs.map(function (t) { return { id: t.id, label: t.name, badge: t.loading ? '…' : t.error ? '!' : t.rows ? t.rows.length : '', closable: true }; });
    el.innerHTML = '<div id="sbp-tabs">' + SU.tabBar(tabs, SetBip.active) + '</div><div id="sbp-body" class="su-fill"></div>';
    $('sbp-tabs').onclick = function (e) {
        var x = e.target.closest('[data-suclose]');
        if (x) { var id = x.getAttribute('data-suclose'); SetBip.tabs = SetBip.tabs.filter(function (t) { return t.id !== id; }); if (SetBip.active === id) SetBip.active = SetBip.tabs.length ? SetBip.tabs[SetBip.tabs.length - 1].id : null; SetBip.render(el); return; }
        var b = e.target.closest('[data-sutab]'); if (b) { SetBip.active = b.getAttribute('data-sutab'); SetBip.render(el); }
    };
    SetBip.drawTab($('sbp-body'), SetBip.tabs.filter(function (t) { return t.id === SetBip.active; })[0] || SetBip.tabs[0]);
};

SetBip.newDialog = function () {
    var fields = [{ id: 'file', label: 'Report file name', req: true, ph: 'MyReport.xdo', wide: true }, { id: 'params', label: 'Parameters (optional, one NAME=value per line)', type: 'textarea', rows: 3, ph: 'P_PO_NUMBER=100245' }];
    FX.modal({
        title: '<i class="fa-solid fa-file-waveform"></i> Run a BIP diagnostic report',
        body: FX.form('sbpf_', fields) + '<div class="note">Path: <span class="mono" id="sbpf_path">' + esc(SetBip.BASE) + '…</span><br>Runs with the app\'s Fusion login on <b>' + esc(FX.instance) + '</b> — no user name or password is entered here.</div>',
        buttons: [{ label: 'Cancel', act: 'close' }, { label: '<i class="fa-solid fa-play"></i> Run', cls: 'primary', act: 'run' }],
        onOpen: function () {
            var f = $('sbpf_file'); f.focus();
            f.oninput = function () { var v = f.value.trim(); $('sbpf_path').textContent = SetBip.BASE + (v ? (/\.xdo$/i.test(v) ? v : v + '.xdo') : '…'); };
            f.onkeydown = function (e) { if (e.key === 'Enter') document.querySelector('[data-mact="run"]').click(); };
        },
        onAction: function (a) {
            if (a !== 'run') return;
            var v = FX.formVals('sbpf_', fields);
            var file = v.file.replace(/^.*\//, '').trim();
            if (!file) { FX.toast('Enter the report file name.', 'err'); return false; }
            if (!/\.xdo$/i.test(file)) file += '.xdo';
            if (!/^[A-Za-z0-9_\- .]+\.xdo$/i.test(file)) { FX.toast('Use a plain report file name (letters, digits, _ - . and spaces).', 'err'); return false; }
            SetBip.add(file, v.params);
        }
    });
};

SetBip.add = function (file, params) {
    var t = { id: 'b' + (++SetBip.seq), file: file, name: file.replace(/\.xdo$/i, ''), path: SetBip.BASE + file, paramsText: params || '', params: SetBip.parseParams(params) };
    SetBip.tabs.push(t); SetBip.active = t.id; SetBip.remember(file, params);
    SetBip.run(t);
};
/** Run (or re-run) a tab in place. */
SetBip.run = function (t) {
    t.loading = true; t.error = null;
    if (FX.cur && FX.cur.id === 'uat') SetBip.render($('fx-view'));
    var t0 = Date.now();
    FX.host('omBip', { path: t.path, params: t.params }).then(function (r) {
        if (!r || r.ok === false) throw (r && r.error) || 'The report did not answer.';
        var rows = r.rows || [], cols = [];
        rows.forEach(function (row) { Object.keys(row).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
        t.rows = rows; t.cols = cols; t.ms = r.ms || (Date.now() - t0); t.at = new Date(); t.added = null;
        FX.toast(t.name + ': ' + rows.length + ' rows.', 'ok');
    }).catch(function (e) { t.error = String(e); t.ms = Date.now() - t0; }).then(function () {
        t.loading = false;
        if (FX.cur && FX.cur.id === 'uat') SetBip.render($('fx-view'));
    });
};

SetBip.drawTab = function (body, t) {
    if (!t) return;
    var head = '<div class="card su-info"><div><span>Report</span><b>' + esc(t.name) + '</b></div><div class="grow"><span>Path</span><code class="su-code">' + esc(t.path) + '</code></div>' +
        (Object.keys(t.params).length ? '<div><span>Parameters</span><b class="mono">' + esc(Object.keys(t.params).map(function (k) { return k + '=' + t.params[k]; }).join(', ')) + '</b></div>' : '') +
        '<div class="row-btns"><button class="btn sm" data-sbpa="copy" title="Copy path"><i class="fa-regular fa-copy"></i></button><button class="btn sm" data-sbpa="refetch"' + (t.loading ? ' disabled' : '') + '><i class="fa-solid fa-rotate"></i> Re-fetch</button>' +
        (t.rows && t.rows.length ? '<button class="btn sm" data-sbpa="xlsx"><i class="fa-solid fa-file-excel"></i> Export Excel</button><button class="btn sm" data-sbpa="acct"><i class="fa-solid fa-book"></i> Get account description</button>' : '') + '</div></div>';
    if (t.loading) { body.innerHTML = head + '<div class="card">' + SU.loading('Running ' + t.path + '…') + '</div>'; }
    else if (t.error) body.innerHTML = head + '<div class="card pad">' + SU.err(t.error) + '<div class="row-btns" style="margin-top:8px"><button class="btn sm" data-sbpa="refetch"><i class="fa-solid fa-rotate"></i> Retry</button></div></div>';
    else {
        body.innerHTML = head + '<div class="card su-fill" id="sbp-grid"></div>';
        var cols = t.cols.map(function (c) {
            var isId = SetBip.ID_RE.test(c);
            return { k: c, label: c, w: 140, th: (isId ? '<i class="fa-solid fa-link" style="color:var(--accent)"></i> ' : '') + esc(c) + (c === t.added ? ' <span class="chip ok">new</span>' : ''), mono: isId,
                html: isId ? function (r) { var v = r[c]; return v == null || v === '' ? '' : '<a class="su-a" data-sbpd="' + esc(c) + '" data-v="' + esc(v) + '">' + esc(v) + '</a>'; } : null };
        });
        SU.table($('sbp-grid'), { rows: t.rows, columns: cols, pageSize: 100, sizes: [50, 100, 200, 500], quickPh: 'Search any value…', empty: 'The report returned no rows.',
            toolbar: '<span class="chip">' + (t.ms / 1000).toFixed(1) + 's</span><span class="chip info">' + t.cols.length + ' columns</span><span class="muted" style="font-size:.72rem">' + esc(t.at.toLocaleTimeString()) + '</span>' });
    }
    body.onclick = function (e) {
        var d = e.target.closest('[data-sbpd]'); if (d) { SetBip.drill(t, d.getAttribute('data-sbpd'), d.getAttribute('data-v')); return; }
        var b = e.target.closest('[data-sbpa]'); if (!b) return;
        var a = b.getAttribute('data-sbpa');
        if (a === 'copy') SU.copy(t.path);
        else if (a === 'refetch') SetBip.run(t);
        else if (a === 'xlsx') SU.xlsx(SU.safeFile(t.name), [{ name: t.name, aoa: SU.aoa(t.rows, t.cols.map(function (c) { return { k: c, label: c }; })) }]);
        else if (a === 'acct') SetBip.accountDesc(t);
    };
};

SetBip.drill = function (t, col, val) {
    var rows = t.rows.filter(function (r) { return String(r[col]) === val; });
    FX.modal({
        title: '<i class="fa-solid fa-link"></i> ' + esc(col) + ' = <span class="mono">' + esc(val) + '</span>', wide: true,
        body: '<div class="muted">' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' of ' + esc(t.name) + '</div>' +
            FX.table(rows, t.cols.map(function (c) { return { label: c, html: function (r) { return c === col ? '<b class="su-hl">' + esc(r[c]) + '</b>' : esc(r[c]); } }; })),
        buttons: [{ label: '<i class="fa-solid fa-file-excel"></i> Export Excel', act: 'x' }, { label: 'Close', act: 'close' }],
        onAction: function (a) { if (a === 'x') { SU.xlsx('DrillDown_' + SU.safeFile(col) + '_' + SU.safeFile(val), [{ name: 'DrillDown', aoa: SU.aoa(rows, t.cols.map(function (c) { return { k: c, label: c }; })) }]); return false; } }
    });
};

/** Adds <ACCOUNT>_DESC after the first account-like column, from the natural-account value set (read now if needed). */
SetBip.accountDesc = function (t) {
    var col = null;
    SetBip.ACCT_RES.some(function (re) { col = t.cols.filter(function (c) { return re.test(c) && !/_DESC$/i.test(c); })[0]; return !!col; });
    if (!col) { FX.toast('No account column found (ACCOUNT, ACCT, SEGMENT4, SEG4, COA, NATURAL_ACCOUNT).', 'err'); return; }
    var seg = SetCoa.accountSeg();
    if (!seg) { FX.toast('No account segment in COA Segments › Segment list.', 'err'); return; }
    FX.busy('Reading ' + seg.valueSet + '…');
    SetCoa.values(seg.valueSet).then(function (vals) {
        FX.busy(false);
        var map = {}; vals.forEach(function (v) { map[String(v.Value).trim()] = SetCoa.desc(v); });
        var nc = col + '_DESC', hit = 0;
        t.rows.forEach(function (r) { var d = map[String(r[col] == null ? '' : r[col]).trim()]; r[nc] = d || ''; if (d) hit++; });
        if (t.cols.indexOf(nc) < 0) t.cols.splice(t.cols.indexOf(col) + 1, 0, nc);
        t.added = nc;
        FX.toast('Added ' + nc + ' — ' + hit + ' / ' + t.rows.length + ' rows matched (' + seg.label + ', ' + vals.length + ' values).', 'ok');
        if (FX.cur && FX.cur.id === 'uat') SetBip.render($('fx-view'));
    }).catch(function (e) { FX.busy(false); FX.toast(String(e), 'err'); });
};

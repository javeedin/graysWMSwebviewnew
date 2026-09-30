/* Fusion Model — Fusion packs (GL, AP, AR, PO, OM, INV: tables on the standard Fusion tables, measures, glossary,
   reconciliation checks — shipped with the engine) and the Model › Checks section (edit and run reconciliation
   checks). Host actions: fmPacks, fmPackProbe (+ fmProgress), fmPackApply, fmChecks. */

var PK = { packs: null, probe: {}, open: null, checkResults: null, running: false };

function openPacks() {
    modal('<div class="mh"><b><i class="fa-solid fa-box-open"></i> Fusion packs</b><small class="muted">ready-made modules on the standard Oracle Fusion tables — check them on your pod, then add them</small>' +
        '<button class="btn sm" data-mact="close"><i class="fa-solid fa-xmark"></i></button></div><div id="pk-body" class="pk-body"><div class="muted pad">Loading…</div></div>', 'wide');
    fm('fmPacks').then(function (r) { PK.packs = r.packs || []; renderPacks(); }).catch(function (e) { $('pk-body').innerHTML = '<div class="err pad">' + esc(e) + '</div>'; });
}

function renderPacks() {
    var el = $('pk-body'); if (!el) return;
    el.innerHTML = '<div class="pk-grid">' + PK.packs.map(function (p) {
        var pr = PK.probe[p.id], open = PK.open === p.id;
        var probe = !pr ? '' : pr.running ? '<div class="pk-probe"><i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(pr.msg || 'Checking…') + '</div>' :
            '<div class="pk-probe">' + pr.results.map(function (x) {
                return '<div class="' + (x.ok ? 'ok' : 'bad') + '"><i class="fa-solid fa-' + (x.ok ? 'circle-check' : 'circle-xmark') + '"></i> <b>' + esc(x.table.split('.').pop()) + '</b> ' +
                    (x.ok ? '<span class="muted">' + (x.sampleRows ? 'columns match · rows found' : 'query runs · no rows yet') + ' · ' + x.ms + ' ms</span>' : '<span>' + esc(x.error || '') + '</span>') + '</div>';
            }).join('') + '</div>';
        return '<div class="pk-card' + (p.applied ? ' on' : '') + '">' +
            '<div class="pk-h"><span class="pk-area">' + esc(p.area) + '</span>' + (p.applied ? '<span class="pill ok2"><i class="fa-solid fa-check"></i> in the model · v' + esc(p.applied) + '</span>' : '') + '</div>' +
            '<h3>' + esc(p.title) + ' <small class="muted mono">' + esc(p.module) + '</small></h3><p class="sm">' + esc(p.description) + '</p>' +
            '<div class="pk-counts"><span><b>' + p.tables.length + '</b> tables</span><span><b>' + p.measures.length + '</b> measures</span><span><b>' + p.checks.length + '</b> checks</span><span><b>' + p.glossary.length + '</b> terms</span></div>' +
            probe +
            '<div class="row">' +
            '<button class="btn sm" data-pk="probe" data-id="' + p.id + '"><i class="fa-solid fa-stethoscope"></i> Check on pod</button>' +
            (S.isAdmin ? '<button class="btn sm primary" data-pk="apply" data-id="' + p.id + '"><i class="fa-solid fa-plus"></i> ' + (p.applied ? 'Add missing parts' : 'Add to model') + '</button>' +
                (p.applied ? '<button class="btn sm" data-pk="overwrite" data-id="' + p.id + '" title="Replace the pack\'s tables, measures, terms and checks with the shipped version"><i class="fa-solid fa-rotate"></i> Reset</button>' : '') : '') +
            '<button class="btn sm" data-pk="details" data-id="' + p.id + '" style="margin-left:auto">' + (open ? 'Hide' : 'Details') + '</button></div>' +
            (open ? '<div class="pk-details">' +
                (p.notes && p.notes.length ? '<div class="pk-notes">' + p.notes.map(function (n) { return '<div><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(n) + '</div>'; }).join('') + '</div>' : '') +
                '<div class="rgroup">Tables</div>' + p.tables.map(function (t) { return '<details><summary><b>' + esc(t.name) + '</b> <span class="muted sm">' + esc(t.strategy) + ' · ' + t.columns + ' columns — ' + esc(t.description || '') + '</span></summary><pre class="code">' + esc(t.sql) + '</pre></details>'; }).join('') +
                '<div class="rgroup">Measures</div><div class="pk-ms">' + p.measures.map(function (m) { return '<span title="' + esc(m.expression) + '">[' + esc(m.name) + ']</span>'; }).join('') + '</div>' +
                '<div class="rgroup">Checks</div>' + p.checks.map(function (c) { return '<div class="sm"><i class="fa-solid fa-scale-balanced"></i> <b>' + esc(c.name) + '</b> — ' + esc(c.description) + '</div>'; }).join('') +
                '</div>' : '') +
            '</div>';
    }).join('') + '</div>' +
    '<p class="muted sm pad">Tables read the standard Fusion tables through the Fusion SQL runner. <b>Check on pod</b> runs each query for its first rows and compares the columns — nothing is loaded. After adding, refresh the new modules in Modules.</p>';
}

function probePack(id) {
    PK.probe[id] = { running: true, msg: 'Starting…' }; renderPacks();
    fm('fmPackProbe', { id: id }, function (m) { PK.probe[id].msg = m; renderPacks(); })
        .then(function (r) { PK.probe[id] = { results: r.results || [] }; })
        .catch(function (e) { PK.probe[id] = { results: [{ table: id, ok: false, error: String(e), ms: 0 }] }; })
        .then(renderPacks);
}

function applyPack(id, overwrite) {
    if (S.dirty) { toast('Save or discard your model changes first'); return; }
    if (overwrite && !confirm('Replace this pack\'s tables, measures, terms and checks with the shipped version? Your changes to them are lost.')) return;
    busy('Adding the pack…');
    fm('fmPackApply', { id: id, overwrite: !!overwrite }).then(function (r) {
        busy(null);
        var x = r.result || {};
        toast((x.added || []).length + ' added' + ((x.updated || []).length ? ', ' + x.updated.length + ' replaced' : '') + ((x.kept || []).length ? ', ' + x.kept.length + ' kept as you changed them' : ''));
        return loadAll().then(function () { return fm('fmPacks'); }).then(function (r2) { PK.packs = r2.packs; renderPacks(); });
    }).catch(function (e) { busy(null); toast(String(e)); });
}

// ── Model › Checks ────────────────────────────────────────────
function renderChecks() {
    var m = studioModel(); m.checks = m.checks || [];
    var res = {}; (PK.checkResults || []).forEach(function (r) { res[r.name] = r; });
    var pass = (PK.checkResults || []).filter(function (r) { return r.status === 'PASS'; }).length;
    $('studio-main').innerHTML = '<div class="card"><div class="mh"><b>Reconciliation checks</b><small class="muted">two measures that must agree for every group — subledger vs GL, journals vs balances, invoices vs schedules. They run on the published data with the security roles of the user.</small>' +
        '<button class="btn sm primary" data-act="ckrun"' + (PK.running ? ' disabled' : '') + '><i class="fa-solid fa-' + (PK.running ? 'circle-notch fa-spin' : 'play') + '"></i> Run all</button>' +
        (S.isAdmin ? '<button class="btn sm" data-act="ckadd"><i class="fa-solid fa-plus"></i> Check</button>' : '') + '</div>' +
        (PK.checkResults ? '<div class="ck-sum"><span class="ck-b PASS">' + pass + ' pass</span><span class="ck-b FAIL">' + PK.checkResults.filter(function (r) { return r.status === 'FAIL'; }).length + ' fail</span>' +
            '<span class="ck-b ERROR">' + PK.checkResults.filter(function (r) { return r.status === 'ERROR'; }).length + ' error</span><span class="ck-b EMPTY">' + PK.checkResults.filter(function (r) { return r.status === 'EMPTY'; }).length + ' no data</span></div>' : '') +
        (m.checks.length ? m.checks.map(function (c, i) {
            var r = res[c.name];
            return '<div class="card ck"><div class="ck-top">' + (r ? '<span class="ck-b ' + r.status + '">' + r.status + '</span>' : '<span class="ck-b">not run</span>') +
                '<input class="ck-name" data-ci="' + i + '" data-cf2="name" value="' + esc(c.name || '') + '"' + (S.isAdmin ? '' : ' readonly') + '>' +
                (r && r.status !== 'ERROR' ? '<small class="muted">' + r.groups + ' groups · ' + r.failing + ' differ' + (r.skipped ? ' · ' + r.skipped + ' one-sided' : '') + ' · ' + r.ms + ' ms</small>' : '') +
                (S.isAdmin ? '<button class="btn xs" data-act="ckdel" data-ci="' + i + '" style="margin-left:auto"><i class="fa-solid fa-trash"></i></button>' : '') + '</div>' +
                '<input class="desc" data-ci="' + i + '" data-cf2="description" value="' + esc(c.description || '') + '" placeholder="What must agree">' +
                '<div class="ck-grid"><label class="fld"><span>Left <input class="lbl" data-ci="' + i + '" data-cf2="leftLabel" value="' + esc(c.leftLabel || '') + '" placeholder="label"></span><textarea class="dax" rows="2" data-ci="' + i + '" data-cf2="left">' + esc(c.left || '') + '</textarea></label>' +
                '<label class="fld" style="max-width:120px"><span>Must be</span><select data-ci="' + i + '" data-cf2="op"><option value="="' + (c.op === '=' || !c.op ? ' selected' : '') + '>equal</option><option value="<="' + (c.op === '<=' ? ' selected' : '') + '>≤ right</option><option value=">="' + (c.op === '>=' ? ' selected' : '') + '>≥ right</option></select>' +
                '<span style="margin-top:6px">± tolerance</span><input type="number" step="any" data-ci="' + i + '" data-cf2="tolerance" value="' + (c.tolerance != null ? c.tolerance : 0.01) + '"></label>' +
                '<label class="fld"><span>Right <input class="lbl" data-ci="' + i + '" data-cf2="rightLabel" value="' + esc(c.rightLabel || '') + '" placeholder="label"></span><textarea class="dax" rows="2" data-ci="' + i + '" data-cf2="right">' + esc(c.right || '') + '</textarea></label></div>' +
                '<div class="row"><label class="fld grow"><span>For every (columns, comma separated)</span><input data-ci="' + i + '" data-cf2="by" value="' + esc((c.by || []).join(', ')) + '" placeholder="ledgers[LEDGER_NAME], calendar[YearMonth]"></label>' +
                '<label class="chk" style="align-self:end"><input type="checkbox" data-ci="' + i + '" data-cf2="bothSides"' + (c.bothSides ? ' checked' : '') + '> only groups with both sides</label></div>' +
                (r && r.error ? '<p class="' + (r.status === 'EMPTY' ? 'muted' : 'err') + ' sm"><i class="fa-solid fa-' + (r.status === 'EMPTY' ? 'circle-info' : 'triangle-exclamation') + '"></i> ' + esc(r.error) + '</p>' : '') +
                (r && r.rows && r.rows.length ? '<div class="grid mini"><table><thead><tr>' + r.columns.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                    r.rows.slice(0, 25).map(function (row) { return '<tr>' + row.map(function (v, j) { return '<td' + (j >= row.length - 3 ? ' class="n' + (j === row.length - 1 ? ' diff' : '') + '"' : '') + '>' + esc(j >= row.length - 3 ? fmtValue(v, '#,0.00') : v) + '</td>'; }).join('') + '</tr>'; }).join('') +
                    '</tbody></table>' + (r.failing > 25 ? '<div class="muted sm pad">' + r.failing + ' groups differ — the 25 biggest are shown</div>' : '') + '</div>' : '') +
                '</div>';
        }).join('') : '<p class="muted">No checks yet. Add a Fusion pack (Modules › Fusion packs) or write one: two measures and the columns to compare them by.</p>') + '</div>';
}

function runChecks() {
    if (S.dirty) { toast('Save the model first, then run the checks'); return; }
    PK.running = true; renderChecks();
    fm('fmChecks').then(function (r) { PK.checkResults = r.results || []; })
        .catch(function (e) { toast(String(e)); })
        .then(function () { PK.running = false; if (ST.sec === 'checks') renderChecks(); });
}

document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pk], [data-act="packs"], [data-act="ckrun"], [data-act="ckadd"], [data-act="ckdel"]');
    if (!b) return;
    var d = b.dataset;
    if (d.act === 'packs') return openPacks();
    if (d.act === 'ckrun') return runChecks();
    if (d.act === 'ckadd') { var m = studioModel(); m.checks = m.checks || []; m.checks.push({ name: 'New check', description: '', left: '', right: '', op: '=', tolerance: 0.01, by: [] }); markDirty(); return renderChecks(); }
    if (d.act === 'ckdel') { studioModel().checks.splice(+d.ci, 1); markDirty(); return renderChecks(); }
    if (d.pk === 'probe') return probePack(d.id);
    if (d.pk === 'apply') return applyPack(d.id, false);
    if (d.pk === 'overwrite') return applyPack(d.id, true);
    if (d.pk === 'details') { PK.open = PK.open === d.id ? null : d.id; return renderPacks(); }
});
function onCheckEdit(e) {
    var x = e.target, d = x.dataset;
    if (d.ci == null || !d.cf2 || !S.model) return;
    var c = studioModel().checks[+d.ci]; if (!c) return;
    c[d.cf2] = d.cf2 === 'by' ? csvList(x.value) : d.cf2 === 'tolerance' ? (+x.value || 0) : d.cf2 === 'bothSides' ? x.checked : x.value;
    markDirty();
}
document.addEventListener('input', onCheckEdit);
document.addEventListener('change', function (e) { if (e.target.dataset.cf2 === 'op' || e.target.dataset.cf2 === 'bothSides') onCheckEdit(e); });

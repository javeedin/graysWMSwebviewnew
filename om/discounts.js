/* Order Management — Discounts: rule list (WMS_OM_DISCOUNTS), add / edit, import (Excel paste or CSV, legacy
   FUSION_DISCOUNTS column names work), sync from the Fusion discount report, and a simulator that shows which rule
   wins for a customer + item and why. */

var DSC = { inited: false };
function discOpen() {
    if (!DSC.inited) {
        DSC.inited = true;
        var t = null; $('d-q').oninput = function () { clearTimeout(t); t = setTimeout(discRender, 200); };
        $('d-ctx').onchange = $('d-state').onchange = discRender;
        $('d-add').onclick = function () { discEdit(null); };
        $('d-import').onclick = discImport;
        $('d-sync').onclick = discSync;
        $('d-sim').onclick = discSim;
        $('d-body').onclick = function (e) { var r = e.target.closest('[data-rid]'); if (r) discEdit(r.getAttribute('data-rid')); };
    }
    var adm = omIsAdmin();
    ['d-add', 'd-import', 'd-sync'].forEach(function (id) { $(id).disabled = !adm; $(id).title = adm ? '' : 'Only Order Management admins change discounts (Setup › Rules & Fusion).'; });
    $('d-body').innerHTML = '<div class="muted" style="padding:20px"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading rules…</div>';
    omLoadRules(true).then(discRender).catch(function (e) { $('d-body').innerHTML = '<div class="note warn" style="margin:14px">' + esc(e) + '</div>'; });
}
function discState(r) {
    if (!r.active) return 'off';
    var d = omDay(new Date()), f = omDay(r.from), t = omDay(r.to);
    if (f != null && d < f) return 'future';
    if (t != null && d > t) return 'expired';
    return 'live';
}
function discRender() {
    var q = $('d-q').value.trim().toLowerCase(), ctx = $('d-ctx').value, st = $('d-state').value;
    var rows = (OM.rules || []).filter(function (r) {
        if (ctx && r.ctx !== ctx) return false;
        if (st && discState(r) !== st) return false;
        return !q || [r.custNo, r.custCat, r.target, r.ref, r.level].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var chip = { live: '<span class="chip ok">live</span>', future: '<span class="chip info">future</span>', expired: '<span class="chip muted">expired</span>', off: '<span class="chip muted">off</span>' };
    $('d-body').innerHTML = '<div style="padding:8px 12px" class="muted">' + rows.length + ' of ' + (OM.rules || []).length + ' rules' + (rows.length > 1500 ? ' — showing the first 1,500' : '') + '</div>' +
        '<table class="tbl"><thead><tr><th>Customer</th><th>Category</th><th>Context</th><th>Level</th><th>Target</th><th class="n">%</th><th>From</th><th>To</th><th>Qty</th><th>Excl.</th><th>Reference</th><th>Source</th><th></th></tr></thead><tbody>' +
        rows.slice(0, 1500).map(function (r) {
            return '<tr class="click" data-rid="' + esc(r.id) + '"><td class="mono">' + esc(r.custNo || '') + '</td><td>' + esc(r.custCat || (r.custNo ? '' : 'everyone')) + '</td><td>' + (r.ctx === 'MARKETING' ? '<span class="chip info">marketing</span>' : '<span class="chip">customer</span>') +
                '</td><td>' + esc(OM_LEVEL_LABEL[r.level] || (r.level || 'any')) + '</td><td class="mono">' + esc(r.target) + '</td><td class="n"><b>' + (r.excl ? '—' : r.pct) + '</b></td><td>' + esc(r.from || '') + '</td><td>' + esc(r.to || '') + '</td><td>' +
                (r.minQty || r.maxQty ? esc((r.minQty || 0) + '–' + (r.maxQty || '∞')) : '') + '</td><td>' + (r.excl ? '<span class="chip err">excluded</span>' : '') + '</td><td>' + esc(r.ref) + '</td><td class="muted">' + esc(r.source || '') + '</td><td>' + chip[discState(r)] + '</td></tr>';
        }).join('') + '</tbody></table>';
}
function discEdit(id) {
    var r = id ? (OM.rules || []).filter(function (x) { return String(x.id) === String(id); })[0] : { ctx: 'CUSTOMER', level: '', target: 'ALL', pct: 0, active: true, from: today() };
    if (!r) return;
    var adm = omIsAdmin();
    var lv = '<option value="">Any level (match the value)</option>' + OM_LEVELS.map(function (l) { return '<option value="' + l + '"' + (l === r.level ? ' selected' : '') + '>' + OM_LEVEL_LABEL[l] + '</option>'; }).join('');
    omModal({ title: id ? 'Discount rule ' + esc(id) : 'New discount rule',
        body: '<div class="fgrid">' +
            '<label>Customer number<input id="dr-cno" value="' + esc(r.custNo || '') + '" placeholder="empty = by category"></label>' +
            '<label>Customer category<input id="dr-cat" value="' + esc(r.custCat || '') + '" placeholder="empty + no number = everyone"></label>' +
            '<label>Context<select id="dr-ctx"><option' + (r.ctx === 'CUSTOMER' ? ' selected' : '') + '>CUSTOMER</option><option' + (r.ctx === 'MARKETING' ? ' selected' : '') + '>MARKETING</option></select></label>' +
            '<label>Level<select id="dr-lv">' + lv + '</select></label>' +
            '<label>Target value<input id="dr-tg" value="' + esc(r.target) + '" placeholder="ALL, item, brand, category…"></label>' +
            '<label>Discount %<input id="dr-pct" type="number" step="0.01" value="' + esc(r.pct) + '"></label>' +
            '<label>From<input id="dr-from" type="date" value="' + esc(String(r.from || '').slice(0, 10)) + '"></label>' +
            '<label>To<input id="dr-to" type="date" value="' + esc(String(r.to || '').slice(0, 10)) + '"></label>' +
            '<label>Min qty<input id="dr-min" type="number" value="' + esc(r.minQty || '') + '"></label>' +
            '<label>Max qty<input id="dr-max" type="number" value="' + esc(r.maxQty || '') + '"></label>' +
            '<label>Reference<input id="dr-ref" value="' + esc(r.ref || '') + '"></label>' +
            '<label>Options<span><input type="checkbox" id="dr-excl"' + (r.excl ? ' checked' : '') + '> Exclude this item from all discounts</span><span><input type="checkbox" id="dr-act"' + (r.active ? ' checked' : '') + '> Active</span></label></div>' +
            '<p class="muted" style="font-size:.78rem">Per line the best CUSTOMER rule and the best MARKETING rule are added together (plus the additional % typed on the line). A rule matches when its target equals the line\'s item, group code, sub-category, category, brand, supplier or profit centre (or ALL).</p>',
        buttons: [{ label: 'Cancel', act: 'close' }].concat(id && adm ? [{ label: 'Delete', cls: 'danger', act: 'del' }] : []).concat(adm ? [{ label: 'Save', cls: 'primary', act: 'save' }] : []),
        onAction: function (a) {
            if (a === 'del') return omWrite('DELETE FROM wms_om_discounts WHERE rule_id = ' + omN(id)).then(function () { toast('Deleted.'); discOpen(); });
            if (a !== 'save') return;
            var v = { ctx: $('dr-ctx').value, disc_level: $('dr-lv').value, target: $('dr-tg').value.trim() || 'ALL', pct: omNum($('dr-pct').value), valid_from: $('dr-from').value, valid_to: $('dr-to').value,
                min_qty: $('dr-min').value, max_qty: $('dr-max').value, disc_ref: $('dr-ref').value.trim(), cust_no: $('dr-cno').value.trim(), cust_cat: $('dr-cat').value.trim(), excl: $('dr-excl').checked ? 'Y' : 'N', active: $('dr-act').checked ? 'Y' : 'N' };
            var vals = discVals(v);
            var sql = id ? 'UPDATE wms_om_discounts SET ' + Object.keys(vals).map(function (k) { return k + ' = ' + vals[k]; }).join(', ') + ', updated_by = ' + omLit(OM.user) + ', updated_date = SYSDATE WHERE rule_id = ' + omN(id)
                : 'INSERT INTO wms_om_discounts (' + Object.keys(vals).join(', ') + ", source, updated_by) VALUES (" + Object.keys(vals).map(function (k) { return vals[k]; }).join(', ') + ", 'MANUAL', " + omLit(OM.user) + ')';
            return omWrite(sql).then(function () { toast('Saved.', 'ok'); discOpen(); }).catch(function (e) { toast(String(e), 'err'); return false; });
        } });
}
function discVals(v) {
    return { ctx: omV(v.ctx, 20), disc_level: omV(v.disc_level, 30), target: omV(v.target, 200), pct: omN(v.pct), valid_from: omD(v.valid_from), valid_to: omD(v.valid_to), min_qty: omN(v.min_qty), max_qty: omN(v.max_qty),
        disc_ref: omV(v.disc_ref, 200), cust_no: omV(v.cust_no, 60), cust_cat: omV(v.cust_cat, 120), excl: omV(v.excl, 1), active: omV(v.active || 'Y', 1) };
}
function discIso(d) { d = omParseDate(d); return d ? d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) : ''; }
/** Write normalised rules in batches; replaceSource = delete that source's rows first (sync / re-import). */
function discWriteRules(rules, source, replaceSource) {
    var sels = rules.map(function (r) {
        var v = discVals({ ctx: r.ctx, disc_level: r.level, target: r.target, pct: r.pct, valid_from: discIso(r.from), valid_to: discIso(r.to), min_qty: r.minQty || '', max_qty: r.maxQty || '',
            disc_ref: r.ref, cust_no: r.custNo, cust_cat: r.custCat, excl: r.excl ? 'Y' : 'N', active: r.active ? 'Y' : 'N' });
        return 'SELECT ' + Object.keys(v).map(function (k) { return v[k]; }).join(', ') + ', ' + omLit(source) + ', ' + omLit(OM.user) + ' FROM dual';
    });
    var batches = [], cur = [], size = 0;
    sels.forEach(function (s) { if (cur.length && (cur.length >= 200 || size + s.length > 120000)) { batches.push(cur); cur = []; size = 0; } cur.push(s); size += s.length; });
    if (cur.length) batches.push(cur);
    var cols = 'ctx, disc_level, target, pct, valid_from, valid_to, min_qty, max_qty, disc_ref, cust_no, cust_cat, excl, active, source, updated_by';
    return (replaceSource ? omWrite('DELETE FROM wms_om_discounts WHERE source = ' + omLit(source)) : Promise.resolve()).then(function () {
        return omSeq(batches, function (b, i) { omBusy('Writing rules ' + Math.min((i + 1) * 200, sels.length) + ' / ' + sels.length + '…'); return omWrite('INSERT INTO wms_om_discounts (' + cols + ') ' + b.join(' UNION ALL ')); });
    });
}
function discParseTable(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    if (lines.length < 2) return [];
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : lines[0].indexOf(';') >= 0 ? ';' : ',';
    var split = function (l) {
        if (sep !== ',') return l.split(sep);
        var out = [], cur = '', q = false;
        for (var i = 0; i < l.length; i++) { var c = l[i]; if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; }
        out.push(cur); return out;
    };
    var hdr = split(lines[0]).map(function (h) { return h.trim().toUpperCase().replace(/\s+/g, '_'); });
    return lines.slice(1).map(function (l) { var c = split(l), o = {}; hdr.forEach(function (h, i) { o[h] = (c[i] || '').trim(); }); return o; });
}
function discImport() {
    var parsed = [];
    omModal({ title: '<i class="fa-solid fa-file-import"></i> Import discount rules', wide: true,
        body: '<p class="muted" style="font-size:.8rem">Paste from Excel or open a CSV. Header names: CUSTOMER_NUMBER, CUSTOMER_CAT, ITEM_CODE (target), LEVEL, DISCOUNT_PER, QUALIFIER_CONTEXT, START_DATE_ACTIVE, END_DATE_ACTIVE, EXCLUDER_FLAG, EBS_DISCOUNT_REF, FROM_QTY, TO_QTY — the legacy FUSION_DISCOUNTS view export works as is.</p>' +
            '<div class="row-btns"><input type="file" id="di-file" accept=".csv,.txt,.tsv"><label><input type="checkbox" id="di-replace"> Replace earlier imported rules</label></div>' +
            '<textarea class="big" id="di-text" placeholder="Paste here…"></textarea><div id="di-out"></div>',
        buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Preview', act: 'prev' }, { label: 'Import', cls: 'primary', act: 'go' }],
        onOpen: function () {
            $('di-file').onchange = function () { var f = this.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { $('di-text').value = rd.result; prev(); }; rd.readAsText(f); };
        },
        onAction: function (a) {
            if (a === 'prev') { prev(); return false; }
            if (a !== 'go') return;
            if (!parsed.length) prev();
            if (!parsed.length) { toast('Nothing to import.', 'err'); return false; }
            omBusy('Importing…');
            return discWriteRules(parsed, 'IMPORT', $('di-replace').checked).then(function () { omBusy(null); toast(parsed.length + ' rules imported.', 'ok'); discOpen(); })
                .catch(function (e) { omBusy(null); toast(String(e), 'err'); return false; });
        } });
    function prev() {
        parsed = discParseTable($('di-text').value).map(omNormRule).filter(function (r) { return r.target && (r.pct || r.excl); });
        $('di-out').innerHTML = '<div class="note">' + parsed.length + ' rule(s) read' + (parsed.length ? ' — e.g. ' + parsed.slice(0, 3).map(function (r) { return esc((r.custNo || r.custCat || 'everyone') + ' · ' + r.ctx + ' · ' + r.target + ' ' + r.pct + '%'); }).join('; ') : '') + '</div>';
    }
}
function discSync() {
    omConfirm('Sync from Fusion', 'Read every rule from the Fusion discount report (Setup › Lookup sources › "' + esc((omSrc('discounts') || {}).label) + '") and replace the rules synced earlier? Manual and imported rules stay.', 'Sync').then(function (ok) {
        if (!ok) return;
        omBusy('Reading discounts from Fusion…');
        omRunSource('discounts', {}).then(function (rows) {
            var rules = rows.map(omNormRule).filter(function (r) { return r.target && (r.pct || r.excl); });
            if (!rules.length) throw 'The report returned ' + rows.length + ' rows but no usable rule (need ITEM_CODE + DISCOUNT_PER).';
            return discWriteRules(rules, 'FUSION', true).then(function () { return rules.length; });
        }).then(function (n) { omBusy(null); toast(n + ' rules synced from Fusion.', 'ok'); discOpen(); })
            .catch(function (e) { omBusy(null); toast('Sync failed: ' + e, 'err'); });
    });
}
/** Which rules does a customer + item hit, and which one wins. Uses the open price list for the item's brand / category… */
function discSim() {
    var h = PAD.order ? PAD.order.header : {};
    omModal({ title: '<i class="fa-solid fa-flask"></i> Discount simulator', wide: true,
        body: '<div class="fgrid"><label>Customer number<input id="ds-cno" value="' + esc(h.customerNumber || '') + '"></label><label>Customer category<input id="ds-cat" value="' + esc(h.customerCategory || '') + '"></label>' +
            '<label>Item<input id="ds-item" placeholder="item number"></label><label>Qty<input id="ds-qty" type="number" value="1"></label><label>Order date<input id="ds-date" type="date" value="' + today() + '"></label>' +
            '<label>Brand / category / … <input id="ds-attrs" placeholder="filled from the open price list"></label></div><div id="ds-out"></div>',
        buttons: [{ label: 'Close', act: 'close' }, { label: 'Simulate', cls: 'primary', act: 'go' }],
        onAction: function (a) {
            if (a !== 'go') return;
            var it = (typeof padFind === 'function' && padFind($('ds-item').value)) || null;
            var line = { item: $('ds-item').value.trim(), qty: +$('ds-qty').value || 1, attrs: it ? { pc: it.pc, supplier: it.supplier, brand: it.brand, cat: it.cat, subcat: it.subcat, group: it.group } : {}, itemType: it ? it.itemType : '' };
            if (!it && $('ds-attrs').value.trim()) { var v = $('ds-attrs').value.trim(); line.attrs = { brand: v, cat: v, subcat: v, group: v, supplier: v, pc: v }; }
            if (it) $('ds-attrs').value = [it.brand, it.cat, it.subcat, it.group, it.supplier, it.pc].filter(Boolean).join(' · ');
            var mine = omRulesForCustomer(OM.rules || [], { number: $('ds-cno').value.trim(), category: $('ds-cat').value.trim() });
            var res = omResolveDiscount(line, mine, $('ds-date').value), keys = omLineKeys(line);
            var hits = mine.map(function (r) { return { r: r, lv: omRuleHit(r, keys) }; }).filter(function (x) { return x.lv; });
            $('ds-out').innerHTML = '<div class="kpis"><div class="kpi"><b>' + res.cust + '%</b><span>customer</span></div><div class="kpi"><b>' + res.mkt + '%</b><span>marketing</span></div><div class="kpi"><b>' + (res.cust + res.mkt) + '%</b><span>total (before additional)</span></div></div>' +
                (res.skipped ? '<div class="note warn">' + esc(res.skipped) + '</div>' : '') +
                '<h4 style="margin-top:10px">' + hits.length + ' rule(s) match this customer and item</h4><table class="tbl"><thead><tr><th>Context</th><th>Hit on</th><th>Target</th><th class="n">%</th><th>From</th><th>To</th><th>Qty</th><th>Reference</th><th></th></tr></thead><tbody>' +
                hits.map(function (x) {
                    var win = res.why.some(function (w) { return w.ref === x.r.ref && w.pct === x.r.pct && w.level === x.lv && w.ctx === x.r.ctx; });
                    return '<tr' + (win ? ' style="background:var(--ok-bg)"' : '') + '><td>' + x.r.ctx + '</td><td>' + (OM_LEVEL_LABEL[x.lv] || x.lv) + '</td><td class="mono">' + esc(x.r.target) + '</td><td class="n">' + (x.r.excl ? 'excl.' : x.r.pct) + '</td><td>' + esc(x.r.from || '') + '</td><td>' + esc(x.r.to || '') + '</td><td>' +
                        (x.r.minQty || x.r.maxQty ? (x.r.minQty || 0) + '–' + (x.r.maxQty || '∞') : '') + '</td><td>' + esc(x.r.ref) + '</td><td>' + (win ? '<b style="color:var(--ok)">wins</b>' : '<span class="muted">' + discState(x.r) + '</span>') + '</td></tr>';
                }).join('') + '</tbody></table>';
            return false;
        } });
}

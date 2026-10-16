/* Order Management — Setup: my defaults, business units, rules & Fusion payload options, lookup sources
   (BIP report / Fusion SQL / APEX SQL with Test + column mapping), print layouts, users and order numbers. */

var SET = { sec: 'me', inited: false, srcKey: 'customers' };
function setupOpen() {
    if (!SET.inited) {
        SET.inited = true;
        $('s-nav').onclick = function (e) { var b = e.target.closest('button[data-s]'); if (!b) return; SET.sec = b.getAttribute('data-s'); setupRender(); };
    }
    setupRender();
}
function setupRender() {
    Array.prototype.forEach.call(document.querySelectorAll('#s-nav button'), function (b) { b.classList.toggle('on', b.getAttribute('data-s') === SET.sec); });
    var f = { me: setMe, bus: setBus, general: setGeneral, sources: setSources, layouts: setLayouts, users: setUsers }[SET.sec];
    f($('s-body'));
}
function setAdminNote() { return omIsAdmin() ? '' : '<div class="note warn">Only Order Management admins (' + esc(omGen().admins) + ') can change this.</div>'; }
function setSaveBtn(id) { return omIsAdmin() ? '<div class="row-btns"><button class="btn primary" id="' + id + '"><i class="fa-solid fa-floppy-disk"></i> Save</button><span class="muted" id="' + id + '-msg"></span></div>' : ''; }

// my defaults
function setMe(el) {
    var me = OM.me || {}, bus = OM.settings.BUS || [];
    el.innerHTML = '<h3>My defaults</h3><p class="lead">Used for every new order you start. Your order numbers are <b>' + esc(me.ORDER_PREFIX || '') + '</b> + 6 digits (next: ' + esc(me.NEXT_NO || 1) + ').</p>' +
        '<div class="fgrid"><label>Business unit<select id="me-bu">' + bus.map(function (b) { return '<option' + (b.name === me.BU_NAME ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select></label>' +
        '<label>Warehouse<input id="me-wh" value="' + esc(me.WAREHOUSE || '') + '" placeholder="business unit default"></label>' +
        '<label>Subinventory<input id="me-sub" value="' + esc(me.SUBINVENTORY || '') + '"></label>' +
        '<label>Sales rep<input id="me-rep" value="' + esc(me.SALESREP_NAME || '') + '"></label>' +
        '<label>Price list<input id="me-pl" value="' + esc(me.PRICE_LIST || '') + '"></label></div>' +
        '<div class="row-btns"><button class="btn primary" id="me-save"><i class="fa-solid fa-floppy-disk"></i> Save</button></div>';
    $('me-save').onclick = function () {
        omSaveMe({ bu_name: $('me-bu').value, warehouse: $('me-wh').value.trim(), subinventory: $('me-sub').value.trim(), salesrep_name: $('me-rep').value.trim(), price_list: $('me-pl').value.trim() })
            .then(function () { toast('Saved.', 'ok'); if (!OM.bu || OM.bu.name !== $('me-bu').value) { omSetBu(omBuByName($('me-bu').value)); padBuChanged(); } })
            .catch(function (e) { toast(String(e), 'err'); });
    };
}

// business units
function setBus(el) {
    var bus = JSON.parse(JSON.stringify(OM.settings.BUS || [])), adm = omIsAdmin();
    var cols = [['name', 'Name'], ['buId', 'BU id'], ['buIdTest', 'BU id (TEST)'], ['orgId', 'Inventory org id'], ['warehouse', 'Warehouse'], ['orgCode', 'Org code'], ['subinventory', 'Default subinventory'], ['subinventories', 'Subinventories (comma)'], ['currency', 'Currency'], ['active', 'Active']];
    function draw() {
        el.innerHTML = '<h3>Business units</h3><p class="lead">Replaces the business units that were hard-coded in the old order pad. Order types, price lists and warehouses are read per business unit.</p>' + setAdminNote() +
            '<div style="overflow:auto"><table class="tbl"><thead><tr>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
            bus.map(function (b, i) { return '<tr>' + cols.map(function (c) { return '<td><input data-i="' + i + '" data-k="' + c[0] + '" value="' + esc(b[c[0]] || '') + '"' + (adm ? '' : ' disabled') + '></td>'; }).join('') + '<td>' + (adm ? '<button class="btn sm danger" data-del="' + i + '"><i class="fa-solid fa-trash"></i></button>' : '') + '</td></tr>'; }).join('') +
            '</tbody></table></div>' + (adm ? '<div class="row-btns"><button class="btn" id="bu-add"><i class="fa-solid fa-plus"></i> Business unit</button><button class="btn primary" id="bu-save"><i class="fa-solid fa-floppy-disk"></i> Save</button><button class="btn" id="bu-reset">Reset to starter list</button></div>' : '');
        if (!adm) return;
        el.querySelector('tbody').oninput = function (e) { var t = e.target; if (t.matches('input[data-k]')) bus[+t.getAttribute('data-i')][t.getAttribute('data-k')] = t.value.trim(); };
        el.querySelector('tbody').onclick = function (e) { var b = e.target.closest('[data-del]'); if (b) { bus.splice(+b.getAttribute('data-del'), 1); draw(); } };
        $('bu-add').onclick = function () { bus.push({ name: 'NEW BU', currency: 'MUR', active: 'Y' }); draw(); };
        $('bu-reset').onclick = function () { bus = omSeedFor('BUS'); draw(); };
        $('bu-save').onclick = function () {
            if (bus.some(function (b) { return !b.name || !b.buId; })) { toast('Every business unit needs a name and a BU id.', 'err'); return; }
            omSaveSetting('BUS', bus).then(function () { toast('Saved.', 'ok'); if (OM.bu) omSetBu(omBuByName(OM.bu.name)); }).catch(function (e) { toast(String(e), 'err'); });
        };
    }
    draw();
}

// rules & Fusion
function setGeneral(el) {
    var g = JSON.parse(JSON.stringify(omGen())), adm = omIsAdmin();
    var lt = g.lineTypes || {};
    el.innerHTML = '<h3>Rules &amp; Fusion</h3><p class="lead">How lines are priced and checked, who approves, and how orders are sent to Fusion (REST salesOrdersForOrderHub).</p>' + setAdminNote() +
        '<h4>Pricing &amp; checks</h4><div class="fgrid">' +
        '<label>Decimals<input id="g-prec" type="number" min="0" max="5" value="' + esc(g.precision) + '"></label>' +
        '<label>Tax rates (code=%, comma)<input id="g-tax" value="' + esc(Object.keys(g.taxRates || {}).map(function (k) { return k + '=' + g.taxRates[k]; }).join(', ')) + '"></label>' +
        '<label>Approval above discount %<input id="g-maxd" type="number" value="' + esc(g.maxDiscountPct) + '"></label>' +
        '<label>Return reason required<select id="g-rr"><option value="Y"' + (g.returnReasonRequired !== 'N' ? ' selected' : '') + '>Yes</option><option value="N"' + (g.returnReasonRequired === 'N' ? ' selected' : '') + '>No</option></select></label>' +
        '<label>Customer PO used before<select id="g-dpo"><option value="warn"' + (!g.dupPoBlocks ? ' selected' : '') + '>Warn</option><option value="block"' + (g.dupPoBlocks ? ' selected' : '') + '>Block</option></select></label>' +
        '<label>Payment method credit / cash<input id="g-pm" value="' + esc((g.creditPaymentMethods || {}).credit + ' / ' + (g.creditPaymentMethods || {}).cash) + '"></label>' +
        '</div><h4>People</h4><div class="fgrid">' +
        '<label class="wide">Approvers (app logins, comma) — empty: admins approve<input id="g-appr" value="' + esc(g.approvers || '') + '"></label>' +
        '<label class="wide">Admins (change Setup and Discounts) — empty: everyone<input id="g-adm" value="' + esc(g.admins || '') + '"></label>' +
        '</div><h4>Fusion order</h4><div class="fgrid">' +
        '<label>Source system<input id="g-ss" value="' + esc(g.sourceSystem) + '"></label>' +
        '<label>REST version<input id="g-rv" value="' + esc(g.restVersion) + '"></label>' +
        '<label>Prices<select id="g-pm2"><option value="FROZEN"' + (g.priceMode === 'FROZEN' ? ' selected' : '') + '>Ours, frozen (list + selling price)</option><option value="MPA"' + (g.priceMode === 'MPA' ? ' selected' : '') + '>Fusion list price + manual % adjustment</option><option value="FUSION"' + (g.priceMode === 'FUSION' ? ' selected' : '') + '>Fusion prices it</option></select></label>' +
        '<label>Default return reason<input id="g-drr" value="' + esc(g.defaultReturnReason || '') + '"></label>' +
        Object.keys(OM_LINE_TYPES).map(function (k) { return '<label>' + k + ' → category / line type code<input data-lt="' + k + '" value="' + esc(((lt[k] || {}).cat || OM_LINE_TYPES[k].cat) + ' / ' + ((lt[k] || {}).code || '')) + '"></label>'; }).join('') +
        '<label class="wide">Header extras (JSON, {{placeholders}} from the order header, e.g. {"additionalInformation":[…]})<textarea id="g-hx" class="code" rows="4">' + esc(g.headerExtras ? JSON.stringify(g.headerExtras, null, 2) : '') + '</textarea></label>' +
        '<label class="wide">Line extras (JSON, {{lineNo}} {{item}} {{type}} {{discRef}} {{refOrder}} and header fields)<textarea id="g-lx" class="code" rows="4">' + esc(g.lineExtras ? JSON.stringify(g.lineExtras, null, 2) : '') + '</textarea></label>' +
        '</div>' + setSaveBtn('g-save');
    if (!adm) { Array.prototype.forEach.call(el.querySelectorAll('input,select,textarea'), function (x) { x.disabled = true; }); return; }
    $('g-save').onclick = function () {
        try {
            g.precision = Math.max(0, Math.min(5, +$('g-prec').value || 0));
            g.taxRates = {}; $('g-tax').value.split(',').forEach(function (p) { var kv = p.split('='); if (kv[0] && kv[0].trim()) g.taxRates[kv[0].trim()] = omNum(kv[1]); });
            g.maxDiscountPct = omNum($('g-maxd').value, 50); g.returnReasonRequired = $('g-rr').value; g.dupPoBlocks = $('g-dpo').value === 'block';
            var pm = $('g-pm').value.split('/'); g.creditPaymentMethods = { credit: (pm[0] || '').trim(), cash: (pm[1] || '').trim() };
            g.approvers = $('g-appr').value.trim().toUpperCase(); g.admins = $('g-adm').value.trim().toUpperCase();
            if (g.admins && omCsv(g.admins.split(/[,;]/)).indexOf(OM.user) < 0) { toast('Keep yourself (' + OM.user + ') in the admin list, or you lock yourself out.', 'err'); return; }
            g.sourceSystem = $('g-ss').value.trim() || 'OPS'; g.restVersion = $('g-rv').value.trim() || '11.13.18.05'; g.priceMode = $('g-pm2').value; g.defaultReturnReason = $('g-drr').value.trim();
            g.lineTypes = {}; Array.prototype.forEach.call(el.querySelectorAll('[data-lt]'), function (i) { var p = i.value.split('/'); g.lineTypes[i.getAttribute('data-lt')] = { cat: (p[0] || '').trim(), code: (p[1] || '').trim() }; });
            g.headerExtras = $('g-hx').value.trim() ? JSON.parse($('g-hx').value) : null;
            g.lineExtras = $('g-lx').value.trim() ? JSON.parse($('g-lx').value) : null;
        } catch (e) { toast('Extras must be valid JSON: ' + e.message, 'err'); return; }
        omSaveSetting('GENERAL', g).then(function () { toast('Saved.', 'ok'); }).catch(function (e) { toast(String(e), 'err'); });
    };
}

// lookup sources
function setSources(el) {
    var srcs = JSON.parse(JSON.stringify(OM.settings.SOURCES || OM_SEED_SOURCES)), adm = omIsAdmin();
    function draw() {
        var s = srcs[SET.srcKey];
        el.innerHTML = '<h3>Lookup sources</h3><p class="lead">Where every list and check comes from. A source is a BI Publisher report (path + parameters, like the old screen), a read-only Fusion SQL query (runs through the Fusion SQL runner) or an APEX query. ' +
            '{{BU_ID}} {{BU_NAME}} {{ORG_ID}} {{WAREHOUSE}} {{SUBINVENTORY}} {{USER}} {{TODAY}} and the values each lookup passes are filled in. Test shows the columns that come back; map them when a report uses other names.</p>' + setAdminNote() +
            '<div class="src-list"><div>' + Object.keys(srcs).map(function (k) { return '<div class="src-item' + (k === SET.srcKey ? ' on' : '') + '" data-k="' + k + '"><i class="fa-solid ' + (srcs[k].kind === 'BIP' ? 'fa-file-lines' : srcs[k].kind === 'APEX' ? 'fa-database' : 'fa-code') + '"></i>' + esc(srcs[k].label || k) + '<small>' + srcs[k].kind + '</small></div>'; }).join('') + '</div>' +
            '<div><div class="fgrid"><label>Kind<select id="sr-kind"><option value="BIP"' + (s.kind === 'BIP' ? ' selected' : '') + '>BI Publisher report</option><option value="SQL"' + (s.kind === 'SQL' ? ' selected' : '') + '>Fusion SQL</option><option value="APEX"' + (s.kind === 'APEX' ? ' selected' : '') + '>APEX SQL</option></select></label>' +
            '<label class="wide">Expected columns<input disabled value="' + esc(s.fields || '') + '"></label></div>' +
            (s.kind === 'BIP' ? '<div class="fgrid"><label class="wide">Report path<input id="sr-path" class="code" value="' + esc(s.path || '') + '"></label><label class="wide">Parameters (one per line: NAME=value)<textarea id="sr-params" class="code" rows="5">' +
                esc(Object.keys(s.params || {}).map(function (p) { return p + '=' + s.params[p]; }).join('\n')) + '</textarea></label></div>'
                : '<label class="fgrid" style="display:block"><span class="muted" style="font-size:.72rem;font-weight:700">SQL (one SELECT)</span><textarea id="sr-sql" class="code" rows="10">' + esc(s.sql || '') + '</textarea></label>') +
            '<label class="fgrid" style="display:block"><span class="muted" style="font-size:.72rem;font-weight:700">Column map (one per line: field=SOURCE_COLUMN)</span><textarea id="sr-map" class="code" rows="3">' + esc(Object.keys(s.map || {}).map(function (m) { return m + '=' + s.map[m]; }).join('\n')) + '</textarea></label>' +
            '<div class="row-btns"><input id="sr-test-vars" class="code" style="max-width:420px" placeholder="Test values, e.g. Q_NAME=ABC; PRICE_LIST=…; PRICING_DATE=' + today() + '"><button class="btn" id="sr-test"><i class="fa-solid fa-play"></i> Test</button>' +
            (adm ? '<button class="btn primary" id="sr-save"><i class="fa-solid fa-floppy-disk"></i> Save all sources</button><button class="btn" id="sr-reset">Reset this one to starter</button>' : '') + '</div><div id="sr-out"></div></div></div>';
        el.querySelector('.src-list').onclick = function (e) { var it = e.target.closest('.src-item'); if (it) { keep(); SET.srcKey = it.getAttribute('data-k'); draw(); } };
        $('sr-kind').onchange = function () { keep(); srcs[SET.srcKey].kind = this.value; draw(); };
        $('sr-test').onclick = function () {
            keep();
            var saved = OM.settings.SOURCES; OM.settings.SOURCES = srcs;
            var vars = {}; $('sr-test-vars').value.split(';').forEach(function (kv) { var p = kv.split('='); if (p[0] && p[0].trim()) vars[p[0].trim()] = (p[1] || '').trim(); });
            if (vars.ITEMS) vars.ITEMS = { raw: omIn(vars.ITEMS.split(',')) };
            if (vars.ORDER_NOS) vars.ORDER_NOS = { raw: omIn(vars.ORDER_NOS.split(',')) };
            $('sr-out').innerHTML = '<div class="note"><i class="fa-solid fa-circle-notch fa-spin"></i> Running…</div>';
            var t0 = Date.now();
            omRunSource(SET.srcKey, vars).then(function (rows) {
                OM.settings.SOURCES = saved;
                var cols = rows.length ? Object.keys(rows[0]) : [];
                $('sr-out').innerHTML = '<div class="note">' + rows.length + ' row(s) in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s · columns: <b>' + esc(cols.join(', ') || '—') + '</b></div>' +
                    (rows.length ? '<div style="overflow:auto;max-height:300px"><table class="tbl"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                        rows.slice(0, 20).map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(r[c]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' : '');
            }).catch(function (e) { OM.settings.SOURCES = saved; $('sr-out').innerHTML = '<div class="note warn">' + esc(e) + '</div>'; });
        };
        if (!adm) return;
        $('sr-reset').onclick = function () { srcs[SET.srcKey] = JSON.parse(JSON.stringify(OM_SEED_SOURCES[SET.srcKey] || srcs[SET.srcKey])); draw(); };
        $('sr-save').onclick = function () { keep(); omSaveSetting('SOURCES', srcs).then(function () { OM.lookups = {}; OM.prices = {}; toast('Saved — lookups reload on next use.', 'ok'); }).catch(function (e) { toast(String(e), 'err'); }); };
    }
    function keep() {
        var s = srcs[SET.srcKey]; if (!s) return;
        if ($('sr-path')) s.path = $('sr-path').value.trim();
        if ($('sr-params')) { s.params = {}; $('sr-params').value.split('\n').forEach(function (l) { var i = l.indexOf('='); if (i > 0) s.params[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }); }
        if ($('sr-sql')) s.sql = $('sr-sql').value;
        if ($('sr-map')) { s.map = {}; $('sr-map').value.split('\n').forEach(function (l) { var i = l.indexOf('='); if (i > 0) s.map[l.slice(0, i).trim()] = l.slice(i + 1).trim().toUpperCase(); }); }
    }
    draw();
}

// print layouts
function setLayouts(el) {
    var lays = JSON.parse(JSON.stringify(OM.settings.LAYOUTS || [])), adm = omIsAdmin();
    var cols = [['name', 'Name'], ['path', 'Report path'], ['param', 'Order parameter'], ['extra', 'Extra parameters (A=1; B=2)'], ['bus', 'Only for business units (comma)']];
    function draw() {
        el.innerHTML = '<h3>Print layouts</h3><p class="lead">BI Publisher reports offered under Print and E-mail. The Fusion order number goes into the order parameter. PDFs are kept in C:\\fusion\\OM\\{instance}\\.</p>' + setAdminNote() +
            '<table class="tbl"><thead><tr>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
            lays.map(function (l, i) { return '<tr>' + cols.map(function (c) { return '<td><input data-i="' + i + '" data-k="' + c[0] + '" value="' + esc(l[c[0]] || '') + '"' + (adm ? '' : ' disabled') + '></td>'; }).join('') + '<td>' + (adm ? '<button class="btn sm danger" data-del="' + i + '"><i class="fa-solid fa-trash"></i></button>' : '') + '</td></tr>'; }).join('') +
            '</tbody></table>' + (adm ? '<div class="row-btns"><button class="btn" id="ly-add"><i class="fa-solid fa-plus"></i> Layout</button><button class="btn primary" id="ly-save"><i class="fa-solid fa-floppy-disk"></i> Save</button><button class="btn" id="ly-reset">Reset to starter list</button></div>' : '');
        if (!adm) return;
        el.querySelector('tbody').oninput = function (e) { var t = e.target; if (t.matches('input[data-k]')) lays[+t.getAttribute('data-i')][t.getAttribute('data-k')] = t.value.trim(); };
        el.querySelector('tbody').onclick = function (e) { var b = e.target.closest('[data-del]'); if (b) { lays.splice(+b.getAttribute('data-del'), 1); draw(); } };
        $('ly-add').onclick = function () { lays.push({ name: 'New layout', path: '/Custom/', param: 'Order_Number' }); draw(); };
        $('ly-reset').onclick = function () { lays = omSeedFor('LAYOUTS'); draw(); };
        $('ly-save').onclick = function () {
            if (lays.some(function (l) { return !/^\/?Custom\/.+\.xdo$/i.test(l.path || ''); })) { toast('Report paths must be under /Custom/ and end with .xdo.', 'err'); return; }
            omSaveSetting('LAYOUTS', lays).then(function () { toast('Saved.', 'ok'); }).catch(function (e) { toast(String(e), 'err'); });
        };
    }
    draw();
}

// users
function setUsers(el) {
    el.innerHTML = '<h3>Users</h3><p class="lead">Everyone who opened Order Management. The order prefix + next number make the order number (it must stay unique per source system in Fusion).</p><div id="us-t" class="muted">Loading…</div>';
    omRead("SELECT app_user, bu_name, warehouse, salesrep_name, order_prefix, next_no, TO_CHAR(updated_date, 'YYYY-MM-DD') AS upd FROM wms_om_users ORDER BY app_user", 500).then(function (rows) {
        var adm = omIsAdmin();
        $('us-t').innerHTML = '<table class="tbl"><thead><tr><th>Login</th><th>Business unit</th><th>Warehouse</th><th>Sales rep</th><th>Prefix</th><th>Next no</th><th>Updated</th><th></th></tr></thead><tbody>' + rows.map(function (r) {
            return '<tr><td class="mono">' + esc(r.APP_USER) + '</td><td>' + esc(r.BU_NAME || '') + '</td><td>' + esc(r.WAREHOUSE || '') + '</td><td>' + esc(r.SALESREP_NAME || '') + '</td>' +
                '<td><input data-u="' + esc(r.APP_USER) + '" data-k="order_prefix" value="' + esc(r.ORDER_PREFIX || '') + '"' + (adm ? '' : ' disabled') + ' style="width:90px"></td><td><input data-u="' + esc(r.APP_USER) + '" data-k="next_no" value="' + esc(r.NEXT_NO || '') + '"' + (adm ? '' : ' disabled') + ' style="width:90px"></td><td>' + esc(r.UPD) + '</td>' +
                '<td>' + (adm ? '<button class="btn sm" data-save="' + esc(r.APP_USER) + '">Save</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
        $('us-t').onclick = function (e) {
            var b = e.target.closest('[data-save]'); if (!b) return;
            var u = b.getAttribute('data-save'), pre = $('us-t').querySelector('input[data-u="' + u + '"][data-k="order_prefix"]').value.trim().toUpperCase(), nn = +$('us-t').querySelector('input[data-u="' + u + '"][data-k="next_no"]').value;
            if (!/^[A-Z0-9-]{1,12}$/.test(pre) || !(nn > 0)) { toast('Prefix: letters/digits (max 12); next number > 0.', 'err'); return; }
            omWrite('UPDATE wms_om_users SET order_prefix = ' + omLit(pre) + ', next_no = ' + omN(nn) + ', updated_by = ' + omLit(OM.user) + ', updated_date = SYSDATE WHERE app_user = ' + omLit(u))
                .then(function () { if (u === OM.user) { OM.me.ORDER_PREFIX = pre; OM.me.NEXT_NO = nn; } toast('Saved.', 'ok'); }).catch(function (er) { toast(String(er), 'err'); });
        };
    }).catch(function (e) { $('us-t').innerHTML = '<div class="note warn">' + esc(e) + '</div>'; });
}

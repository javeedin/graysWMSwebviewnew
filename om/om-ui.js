/* Order Management — shared UI: tabs, modal, busy, business unit picker, start-up. */

function omBusy(t) { $('busy').hidden = !t; if (t) $('busy-t').textContent = t; }

/** opts: { title, body (html), wide, buttons: [{label, cls, act}] , onOpen(box), onAction(act, box) → false keeps it open } */
var _omModalOpts = null;
function omModal(opts) {
    if (_omModalOpts && _omModalOpts.onClose) { var oc = _omModalOpts.onClose; _omModalOpts = null; oc(); }
    _omModalOpts = opts;
    var box = $('modal-box');
    box.className = 'modal' + (opts.wide ? ' wide' : '');
    box.innerHTML = '<div class="modal-h"><h3>' + opts.title + '</h3><button class="x" data-mact="close">&times;</button></div>' +
        '<div class="modal-b">' + (opts.body || '') + '</div>' +
        '<div class="modal-f">' + (opts.buttons || [{ label: 'Close', act: 'close' }]).map(function (b) {
            return '<button class="btn ' + (b.cls || '') + '" data-mact="' + b.act + '">' + b.label + '</button>';
        }).join('') + '</div>';
    $('modal').hidden = false;
    box.onclick = function (e) {
        var b = e.target.closest('[data-mact]'); if (!b) return;
        var act = b.getAttribute('data-mact');
        if (act === 'close') { omCloseModal(); return; }
        if (opts.onAction) {
            var r = opts.onAction(act, box, b);
            if (r && r.then) r.then(function (keep) { if (keep !== false) omCloseModal(); }); else if (r !== false) omCloseModal();
        }
    };
    if (opts.onOpen) opts.onOpen(box);
    return box;
}
function omCloseModal() {
    var o = _omModalOpts; _omModalOpts = null;
    $('modal').hidden = true; $('modal-box').innerHTML = '';
    if (o && o.onClose) o.onClose();
}
function omConfirm(title, html, okLabel, cls) {
    return new Promise(function (res) {
        var ok = false;
        omModal({ title: title, body: html, buttons: [{ label: 'Cancel', act: 'close' }, { label: okLabel || 'OK', cls: cls || 'primary', act: 'ok' }],
            onAction: function (a) { if (a === 'ok') ok = true; }, onClose: function () { res(ok); } });
    });
}
function omPrompt(title, label, value) {
    return new Promise(function (res) {
        var v = null;
        omModal({ title: title, body: '<label class="fgrid" style="display:block"><span class="muted" style="font-size:.78rem">' + label + '</span><input id="om-prompt" class="code" value="' + esc(value || '') + '"></label>',
            buttons: [{ label: 'Cancel', act: 'close' }, { label: 'OK', cls: 'primary', act: 'ok' }],
            onOpen: function (box) { var i = box.querySelector('#om-prompt'); setTimeout(function () { i.focus(); i.select(); }, 30); i.onkeydown = function (e) { if (e.key === 'Enter') { v = i.value; omCloseModal(); } }; },
            onAction: function (a) { if (a === 'ok') v = $('om-prompt').value; }, onClose: function () { res(v); } });
    });
}

// ── tabs ───────────────────────────────────────────────────────
function omShowTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab[data-tab]'), function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    Array.prototype.forEach.call(document.querySelectorAll('.page'), function (p) { p.hidden = p.id !== 'page-' + name; });
    lsSet('om_tab', name);
    var open = { pad: window.padOpen, orders: window.ordersOpen, approvals: window.apprOpen, discounts: window.discOpen, setup: window.setupOpen }[name];
    if (open && OM.ready) open();
}

// ── business unit ──────────────────────────────────────────────
function omPickBu(force) {
    var bus = (OM.settings.BUS || []).filter(function (b) { return b.active !== 'N'; });
    var cur = OM.me && OM.me.BU_NAME;
    if (!force && cur && omBuByName(cur)) { omSetBu(omBuByName(cur)); return Promise.resolve(); }
    return new Promise(function (res) {
        omModal({ title: '<i class="fa-solid fa-building"></i> Business unit', body: '<p class="muted" style="font-size:.82rem">Orders, price lists, order types and warehouses follow the business unit.</p>' +
            '<div class="fgrid" style="grid-template-columns:repeat(2,1fr)">' + bus.map(function (b) {
                return '<button class="btn" style="justify-content:flex-start;padding:12px" data-mact="bu" data-bu="' + esc(b.name) + '"><i class="fa-solid fa-building"></i> <span style="text-align:left"><b>' + esc(b.name) + '</b><br><small class="muted">' +
                    esc([b.orgCode, b.warehouse, b.subinventory].filter(Boolean).join(' · ')) + '</small></span></button>';
            }).join('') + '</div>',
            buttons: [{ label: 'Cancel', act: 'close' }],
            onAction: function (a, box, btn) {
                if (a !== 'bu') return;
                var b = omBuByName(btn.getAttribute('data-bu'));
                omSetBu(b); omSaveMe({ bu_name: b.name }).catch(function () { }); res(); if (window.padBuChanged) padBuChanged();
            } });
    });
}
function omSetBu(b) { OM.bu = b; $('bu-name').textContent = b ? b.name : 'Choose business unit'; OM.lookups = {}; }

// ── start ──────────────────────────────────────────────────────
function omStart() {
    OM.user = omAppUser(); OM.instance = omInstance();
    $('who').textContent = OM.user; $('inst').textContent = OM.instance; $('inst').className = 'inst ' + OM.instance;
    Array.prototype.forEach.call(document.querySelectorAll('.tab[data-tab]'), function (b) { b.onclick = function () { omShowTab(b.getAttribute('data-tab')); }; });
    $('bu-pick').onclick = function () { omPickBu(true); };
    $('modal').addEventListener('mousedown', function (e) { if (e.target === $('modal')) omCloseModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('modal').hidden) omCloseModal(); });
    if (!hasHost()) { $('verdict').innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i><div><b>Not connected</b><small>Open this page inside the Gray\'s WMS app.</small></div>'; return; }
    omBusy('Loading Order Management…');
    omEnsureTables().then(omLoadSettings).then(omLoadMe).then(function () {
        omBusy(null); OM.ready = true;
        return omPickBu(false);
    }).then(function () {
        if (window.apprBadge) apprBadge();
        var tab = lsGet('om_tab', 'pad');
        omShowTab(tab === 'setup' || tab === 'discounts' || tab === 'orders' || tab === 'approvals' ? tab : 'pad');
    }).catch(function (e) {
        omBusy(null);
        $('verdict').className = 'card verdict blocked';
        $('verdict').innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><div><b>Could not start</b><small>' + esc(e) + '</small></div>';
        toast('Order Management could not load: ' + e, 'err');
    });
}
document.addEventListener('DOMContentLoaded', function () { setTimeout(omStart, 0); });

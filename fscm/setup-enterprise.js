/* Setup & Diagnostics — Enterprise: Business Units (finBusinessUnitsLOV) and Legal Entities (legalEntitiesLOV).
   Read-only lists; ALL rows are read (offset paging), search over every value, CSV / Excel export. */

var SetEnt = { cache: {} };

SetEnt.BU_LABELS = { BusinessUnitId: 'BU ID', BusinessUnitName: 'Business Unit Name', PrimaryLedgerName: 'Primary Ledger', DefaultLegalContext: 'Legal Context', Status: 'Status' };

/** Shared list view: read every row once (cached per pod), then a client grid. */
SetEnt.list = function (el, o) {
    SU.headRight('<button class="btn sm" id="se-refresh"><i class="fa-solid fa-rotate"></i> Refresh</button> <button class="btn sm" id="se-xlsx"><i class="fa-solid fa-file-excel"></i> Excel</button>');
    var key = o.resource + '|' + FX.instance;
    var rows = null, cols = null;
    function draw() {
        cols = o.columns ? o.columns : Object.keys(rows[0] || {}).filter(function (k) { return k !== 'links'; }).map(function (k) {
            return { k: k, label: SetEnt.BU_LABELS[k] || SU.humanize(k), mono: /Id$/.test(k), html: function (r, v) { return /Status/.test(k) && v ? FX.chip(v) : SU.val(v); } };
        });
        el.innerHTML = '<div class="kpis">' + SU.kpi(rows.length.toLocaleString(), o.kpi, 'acc') + (o.kpis ? o.kpis(rows) : '') + '</div><div class="card" id="se-grid"></div>';
        SU.table($('se-grid'), { columns: cols, rows: rows, pageSize: 50, quickPh: o.ph, sort: o.sort, empty: 'Nothing returned by ' + o.resource + '.', onRow: function (r) { SetEnt.drawer(r, o, cols); } });
    }
    function load(force) {
        if (force) delete SetEnt.cache[key];
        el.innerHTML = SU.loading('Reading ' + o.resource + '…');
        if (!SetEnt.cache[key]) SetEnt.cache[key] = FX.restAll(o.resource, { limit: 500, orderBy: o.orderBy }, 100000, function (n) { var s = el.querySelector('.su-empty span'); if (s) s.textContent = 'Reading ' + o.resource + '… ' + n + ' rows'; })
            .catch(function (e) { delete SetEnt.cache[key]; throw e; });
        SetEnt.cache[key].then(function (r) { rows = r.map(function (x) { var y = Object.assign({}, x); delete y.links; return y; }); draw(); })
            .catch(function (e) { el.innerHTML = SU.err(e); });
    }
    $('se-refresh').onclick = function () { load(true); };
    $('se-xlsx').onclick = function () {
        if (!rows || !rows.length) { FX.toast('Nothing to export yet.'); return; }
        SU.xlsx(o.file + '_' + FX.instance + '_' + FX.today(), [{ name: o.sheet, aoa: SU.aoa(rows, cols.map(function (c) { return { label: c.label, k: c.k }; })) }]);
    };
    load(false);
};
SetEnt.drawer = function (r, o, cols) {
    FX.drawer({
        title: esc(r[o.titleField] || '(no name)'), sub: esc(o.label + ' · ' + FX.instance), raw: r,
        facts: cols.map(function (c) { return [c.label, c.html ? c.html(r, r[c.k]) : SU.val(r[c.k])]; })
    });
};

SetEnt.renderBU = function (el) {
    SetEnt.list(el, {
        resource: 'finBusinessUnitsLOV', label: 'Business unit', kpi: 'Total business units', ph: 'Search business units…', titleField: 'BusinessUnitName',
        orderBy: 'BusinessUnitName', sort: { k: 'BusinessUnitName', d: 1 }, file: 'BusinessUnits', sheet: 'Business Units',
        kpis: function (rows) {
            var led = {}; rows.forEach(function (r) { if (r.PrimaryLedgerName) led[r.PrimaryLedgerName] = 1; });
            var act = rows.filter(function (r) { return !r.Status || /^A/i.test(r.Status); }).length;
            return SU.kpi(Object.keys(led).length, 'Primary ledgers') + (rows.length && rows[0].Status !== undefined ? SU.kpi(act, 'Active', 'ok') : '');
        }
    });
};

SetEnt.renderLE = function (el) {
    var today = FX.today();
    SetEnt.list(el, {
        resource: 'legalEntitiesLOV', label: 'Legal entity', kpi: 'Total legal entities', ph: 'Search legal entities…', titleField: 'Name',
        sort: { k: 'Name', d: 1 }, file: 'LegalEntities', sheet: 'Legal Entities',
        columns: [
            { k: 'LegalEntityId', label: 'Legal Entity ID', mono: true, w: 130 },
            { k: 'Name', label: 'Name', w: 220 },
            { k: 'LegalEntityIdentifier', label: 'Identifier', w: 110 },
            { k: 'EffectiveFrom', label: 'Effective From', w: 120, html: function (r, v) { return SU.dateGB(v); } },
            { k: 'EffectiveTo', label: 'Effective To', w: 120, html: function (r, v) { return v && String(v).slice(0, 10) < today ? '<span class="chip err">' + SU.dateGB(v) + '</span>' : SU.dateGB(v); } },
            { k: 'PartyId', label: 'Party ID', mono: true, w: 120 }
        ],
        kpis: function (rows) {
            var ended = rows.filter(function (r) { return r.EffectiveTo && String(r.EffectiveTo).slice(0, 10) < today; }).length;
            return SU.kpi(rows.length - ended, 'Currently effective', 'ok') + (ended ? SU.kpi(ended, 'End-dated', 'err') : '');
        }
    });
};

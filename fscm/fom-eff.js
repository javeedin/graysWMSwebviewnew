/* Fusion Order Management — Additional Information (extensible flexfields) on order headers and lines (spec §3.0.10).
   Read: <record>/child/additionalInformation → the nested <Header|FulfillLine>EffB<Context>privateVO rows.
   Write: PATCH the VO row, else POST it under the additionalInformation row, else POST a new additionalInformation row
   (content type application/vnd.oracle.adf.resourceitem+json). Contexts come from describe (fallbacks below). */

FOM.EFF_SYS = /^(links|ContextCode|Category|CategoryCode|CategoryName|ObjectVersionNumber|CreatedBy|CreationDate|LastUpdateDate|LastUpdatedBy|LastUpdateLogin|ParentEntity|CorpCurrencyCode|CurcyConvRateType|CurrencyCode|SetId|.*Id|_.*)$/i;
FOM.isSeg = function (n) { return !!n && !FOM.EFF_SYS.test(n); };
FOM.EFF_FB = {
    header: [{ category: 'DOO_HEADERS_ADD_INFO', voName: 'HeaderEffBTransaction__CodeprivateVO', contextCode: 'Transaction Code', segs: [{ name: 'transactionCode', label: 'Transaction Code' }, { name: 'customer', label: 'customer' }, { name: 'branchsalesorder', label: 'Branch Sales Order' }, { name: 'pricelist', label: 'PRICELIST' }, { name: 'branchBusinessUnit', label: 'BRANCH BUSINESS UNIT' }] }],
    line: [{ category: 'DOO_FULFILL_LINES_ADD_INFO', voName: 'FulfillLineEffBaddinfoprivateVO', contextCode: 'addinfo', segs: [{ name: 'itemcost', label: 'Item Cost' }, { name: 'itemlot', label: 'Item Lot' }, { name: 'lotqty', label: 'Lot Qty' }] }]
};
FOM.effCat = {}; // learned Category per flexfield: { header: 'DOO_HEADERS_ADD_INFO', line: … }
FOM.effKind = function (vo) { return /^FulfillLine/i.test(vo) ? 'line' : 'header'; };
FOM.effCtxName = function (vo) { return String(vo || '').replace(/^.*EffB/i, '').replace(/privateVO$/i, '').replace(/_+/g, ' ').trim(); };
/** describe → contexts [{category, voName, contextCode, segs:[{name,label,type}]}] (fallback when nothing parses). */
FOM.effContexts = function (kind) {
    var cat = kind === 'line' ? 'DOO_FULFILL_LINES_ADD_INFO' : 'DOO_HEADERS_ADD_INFO';
    var poly = kind === 'line' ? 'salesOrdersForOrderHub.lines.additionalInformation:' + cat : 'salesOrdersForOrderHub.additionalInformation:' + cat;
    return FOM.once('effd_' + kind, function () {
        return FX.get('salesOrdersForOrderHub/describe', { params: { polymorphicType: poly }, onlyData: false }).then(function (d) {
            var out = [], seen = {};
            (function visit(o) {
                if (!o || typeof o !== 'object') return;
                Object.keys(o).forEach(function (k) {
                    if (/EffB.+privateVO$/i.test(k) && !seen[k]) {
                        seen[k] = 1; var node = o[k], attrs = node && (node.attributes || node.Attributes) || (Array.isArray(node) ? node : []);
                        var segs = attrs.map(function (a) { return { name: a && (a.name || a.Name), label: a && (a.title || a.label || a.Title || a.name || a.Name), type: a && (a.type || a.Type) }; }).filter(function (s) { return FOM.isSeg(s.name); });
                        if (segs.length) out.push({ category: cat, voName: k, contextCode: (node && (node.contextCode || node.ContextCode)) || FOM.effCtxName(k), segs: segs });
                    } else visit(o[k]);
                });
            })(d);
            var mine = out.filter(function (c) { return FOM.effKind(c.voName) === kind; });
            if (mine.length) out = mine;
            if (!out.length) throw 'no contexts';
            return out;
        });
    }).catch(function () { return FOM.EFF_FB[kind]; });
};
/** Line meta: lot / cost segments of the first line context (null = no line EFF is sent). */
FOM.lineEffMeta = function (ctxs) {
    var c = (ctxs || [])[0]; if (!c) return null;
    var lot = c.segs.filter(function (s) { return /lot/i.test(s.name) || /lot/i.test(s.label); })[0], cost = c.segs.filter(function (s) { return /cost/i.test(s.name) || /cost/i.test(s.label); })[0];
    var qty = c.segs.filter(function (s) { return /lot.?qty|qty/i.test(s.name); })[0];
    if (!lot && !cost) return null;
    return { category: c.category, voName: c.voName, contextCode: c.contextCode, lotSeg: lot && lot.name, costSeg: cost && cost.name, qtySeg: qty && qty.name, segs: c.segs };
};
/** fetchEffRows(base) → [{ctx, voName, category, vals, aiSelf, voSelf}] */
FOM.effRows = function (base) {
    return FOM.get(base.replace(/\?.*$/, '') + '/child/additionalInformation', { onlyData: false, limit: 200 }).then(function (j) {
        var items = j.items || [];
        return FOM.mapLimit(items, 4, function (it) {
            var cat = it.Category || it.CategoryCode;
            var l = (it.links || []).filter(function (x) { return /EffB.+privateVO$/i.test(x.name || x.rel || ''); })[0];
            if (!l) return [];
            var vo = ((l.name || '').match(/[A-Za-z_]*EffB.+privateVO$/i) || [l.name])[0];
            if (cat) FOM.effCat[FOM.effKind(vo)] = cat;
            return FOM.get(l.href, { onlyData: false, limit: 200 }).then(function (s) {
                return (s.items || []).map(function (seg) {
                    var vals = {}; Object.keys(seg).forEach(function (k) { if (FOM.isSeg(k) && !FOM.isEmpty(seg[k]) && typeof seg[k] !== 'object') vals[k] = seg[k]; });
                    return { ctx: seg.ContextCode || FOM.effCtxName(vo), voName: vo, category: cat, vals: vals, aiSelf: FOM.self(it), voSelf: FOM.self(seg), voHref: l.href.replace(/\?.*$/, '') };
                });
            });
        }).then(function (ch) { return [].concat.apply([], ch.filter(Array.isArray)); });
    });
};
/** writeEffToRecord(base, ctx {category, voName, contextCode}, vals) → {how, self} */
FOM.effWrite = function (base, ctx, vals, known) {
    var o = { contentType: null }; // default = application/vnd.oracle.adf.resourceitem+json
    var body = {}; Object.keys(vals).forEach(function (k) { if (vals[k] !== '' && vals[k] != null) body[k] = vals[k]; });
    var go = function (method, url, b) { return FOM.raw(method, url, o, b).then(function (r) { if (!r.ok) throw 'HTTP ' + r.status + ': ' + String(r.text || '').slice(0, 300); return r.json || {}; }); };
    var find = known ? Promise.resolve(known) : FOM.effRows(base).then(function (rows) { return rows.filter(function (r) { return r.voName === ctx.voName; })[0] || (rows[0] && !rows.some(function (r) { return r.voName === ctx.voName; }) ? { aiSelf: rows[0].aiSelf, voHrefFor: true } : null); }).catch(function () { return null; });
    return find.then(function (row) {
        if (row && row.voSelf && row.voName === ctx.voName) return go('PATCH', row.voSelf, body).then(function () { return { how: 'PATCH', self: row.voSelf }; });
        if (row && row.aiSelf) return go('POST', row.aiSelf + '/child/' + ctx.voName, Object.assign({ ContextCode: ctx.contextCode }, body)).then(function (j) { return { how: 'POST context', self: FOM.self(j) }; });
        var cat = FOM.effCat[FOM.effKind(ctx.voName)] || ctx.category, b2 = { Category: cat }; b2[ctx.voName] = [Object.assign({ ContextCode: ctx.contextCode }, body)];
        return go('POST', base.replace(/\?.*$/, '') + '/child/additionalInformation', b2).then(function (j) { var v = j[ctx.voName] && j[ctx.voName][0]; return { how: 'POST additionalInformation', self: v ? FOM.self(v) : null }; });
    });
};
FOM.effCards = function (rows) {
    if (!rows.length) return '<div class="empty" style="padding:18px"><i class="fa-solid fa-tags"></i>No additional information on this record.</div>';
    return '<div class="fom-effc">' + rows.map(function (r) { return '<div class="card pad"><div class="row-btns"><b>' + esc(r.ctx) + '</b><span class="grow"></span><span class="muted mono" style="font-size:.66rem">' + esc(r.voName) + '</span></div><div class="facts" style="margin-top:6px">' + Object.keys(r.vals).map(function (k) { return '<div><span>' + esc(FOM.humanize(k)) + '</span>' + esc(r.vals[k]) + '</div>'; }).join('') + '</div></div>'; }).join('') + '</div>';
};

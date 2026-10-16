/* Which order lines the cancellation autopilot cancels — ONE copy of the rule for the WMS (wms/autopilot.js) and
   WMS 2.0 (wms2/w2-autopilot.js). Master: wms/cancel-rules.js; wms2/w2-cancel-rules.js is the same file, copied by
   wms2/legacy/copy-from-wms.py (CI checks they are identical). A line-for-line port of the Shipping Agent's Task 2
   (wms/shipping-agent.js: the getsalesorderlines filter + saExpandCancelLines + saChildBlocked + saLineFulfillId):
     1. main lines: status contains SCHEDULED or MANUAL RESERVATION
     2. their child lines: numbered sub-lines first (3 → 3.1, 3.2 …); only when there are none, the BOGO promo items of the
        main item (ARMODULE/BOGO: main item → promo items)
     3. a child already cancelled / shipped / interfaced is skipped, so is a child without a fulfillment line id — a child in
        Awaiting Shipping (the usual state of a BOGO item whose main line waits for a Manual Reservation) IS cancelled with it
     4. Fusion gets { lines: [{ FulfillLineId, OrderedQuantity: 0, CancelReason: 'OUT OF STOCK' }] } on
        salesOrdersForOrderHub/OPS:{order} (PATCH) — main lines without an id are left out and reported.
   Pure functions (no DOM, no host; global W2CR in the browser): tested by wms2/tests/cancel-rules.test.js. */
(function (root) {
    'use strict';
    var R = {};
    R.lineNum = function (l) { return String(l.LINE_NUMBER || l.line_number || '').trim(); };
    R.lineItem = function (l) { return String(l.PRODUCT_NUMBER || l.product_number || l.ITEM_NUMBER || l.item_number || l.ITEM || l.item || '').trim(); };
    R.lineStatus = function (l) { return String(l.LINE_STATUS || l.line_status || l.STATUS || l.status || '').trim(); };
    R.fid = function (l) {
        return l.FULFILL_LINE_ID || l.fulfill_line_id || l.SOURCE_FULFILLMENT_LINE_ID || l.source_fulfillment_line_id ||
            l.FULFILLMENT_LINE_ID || l.fulfillment_line_id || l.SOURCE_ORDER_FULFILLMENT_LINE_ID || l.source_order_fulfillment_line_id || null;
    };
    R.key = function (l) { return String(R.fid(l) || ('LN:' + R.lineNum(l) + ':' + R.lineItem(l))); };
    /** Task 2's rule for a main line. */
    R.flagged = function (l) { var s = R.lineStatus(l).toUpperCase(); return s.indexOf('SCHEDULED') >= 0 || s.indexOf('MANUAL RESERVATION') >= 0; };
    /** Child lines past the point of no return: cancelled, shipped, interfaced. "Awaiting Shipping" is NOT one of them —
        it is cancelled together with its main line (SHIPPED, not SHIP, so SHIPPING does not match). */
    R.childBlocked = function (status) { var s = String(status || '').toUpperCase(); return s.indexOf('CANCEL') >= 0 || s.indexOf('SHIPPED') >= 0 || s.indexOf('INTERFAC') >= 0; };

    /**
     * One order: all its lines + the BOGO map { MAINITEM: [promoItem, …] } (upper case) →
     * { lines: [main + child lines, each with via MAIN | SUB-LINE | BOGO and childOf], main, children, skipped: [{line, parentNum, via, reason}], noId: [main lines without id] }
     */
    R.expand = function (orderLines, bogo) {
        bogo = bogo || {};
        var flagged = orderLines.filter(R.flagged);
        var included = {}, out = [], skipped = [], noId = [];
        flagged.forEach(function (l) { included[R.key(l)] = 1; out.push({ line: l, via: 'MAIN', childOf: null }); });
        flagged.forEach(function (parent) {
            var pNum = R.lineNum(parent), via = 'SUB-LINE';
            var children = pNum ? orderLines.filter(function (l) { return R.lineNum(l).indexOf(pNum + '.') === 0; }) : [];
            if (!children.length) {
                var promos = bogo[R.lineItem(parent).toUpperCase()] || [];
                if (promos.length) { children = orderLines.filter(function (l) { return promos.indexOf(R.lineItem(l).toUpperCase()) >= 0; }); via = 'BOGO'; }
            }
            children.forEach(function (ch) {
                var k = R.key(ch);
                if (included[k]) return;
                var st = R.lineStatus(ch);
                if (R.childBlocked(st)) { skipped.push({ line: ch, parentNum: pNum, via: via, reason: 'status "' + st + '" not cancellable' }); return; }
                if (!R.fid(ch)) { skipped.push({ line: ch, parentNum: pNum, via: via, reason: 'missing FULFILL_LINE_ID' }); return; }
                included[k] = 1;
                out.push({ line: ch, via: via, childOf: pNum || R.lineItem(parent) });
            });
        });
        out = out.filter(function (x) { if (x.via === 'MAIN' && !R.fid(x.line)) { noId.push(x.line); return false; } return true; });
        return { lines: out, main: flagged.length, children: out.filter(function (x) { return x.via !== 'MAIN'; }).length, skipped: skipped, noId: noId };
    };

    /** The PATCH body the Shipping Agent sends (salesOrdersForOrderHub/OPS:{order}). */
    R.body = function (set) { return { lines: set.map(function (x) { return { FulfillLineId: R.fid(x.line), OrderedQuantity: 0, CancelReason: 'OUT OF STOCK' }; }) }; };
    R.url = function (base, order) { return base + '/fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/OPS:' + encodeURIComponent(order); };

    /** Rows of ARMODULE/BOGO → { MAINITEM: [PROMOITEM, …] } */
    R.bogoMap = function (rows) {
        var m = {};
        (rows || []).forEach(function (it) {
            var main = String(it.mainitemcode || it.MAINITEMCODE || it.main_item || '').trim().toUpperCase(), promo = String(it.promoitemcode || it.PROMOITEMCODE || it.promo_item || '').trim().toUpperCase();
            if (!main || !promo) return;
            m[main] = m[main] || []; if (m[main].indexOf(promo) < 0) m[main].push(promo);
        });
        return m;
    };

    /** A Fusion PATCH answer that says it failed (the host passes HTTP errors back as data). */
    R.patchError = function (res) {
        if (res == null || res === '') return null;
        if (typeof res === 'string') { try { res = JSON.parse(res); } catch (e) { return /error|exception|denied|invalid/i.test(res) ? res.slice(0, 300) : null; } }
        if (res.ReturnStatus === 'Error') return res.ErrorExplanation || res.ErrorCode || 'Error';
        if (res.status && +res.status >= 400) return (res.title || 'HTTP ' + res.status) + (res.detail ? ': ' + res.detail : '');
        if (res['o:errorDetails']) return JSON.stringify(res['o:errorDetails']).slice(0, 300);
        return null;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = R;
    else root.W2CR = R;
})(typeof window !== 'undefined' ? window : this);

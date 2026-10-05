/* Finance Lens — IFRS pack engine (FIFRS). Pure: runs in the page and in node (finance/tests/engine.test.js).
   From the trial balance facts (FL.data(): {accounts, periods, facts.ACTUAL[account][period_seq] = [net, end]}) it builds:
   - statement of financial position (IAS 1.54) at the period end vs the previous financial year end (IAS 34 comparatives)
   - statement of profit or loss and OCI (IAS 1.81A–82A) by function or by nature, year to date vs the same period last year
   - statement of changes in equity (IAS 1.106) — current and comparative blocks
   - statement of cash flows (IAS 7, indirect) — ties to the change in cash by construction (every balance sheet account is in a line)
   - note data (expenses by nature, revenue, PPE / ROU / intangibles roll-forward, income tax reconciliation, borrowings & leases,
     related parties, EPS) and automatic checks.
   Every account gets an IFRS line from its class (FINE.classify when the chart has none) and name; overrides per account:
   map = { sfp: {code: lineId}, fn: {code: lineId}, nat: {code: lineId} }. Amounts are presented credit-positive for income,
   equity and liabilities and debit-positive for assets; P&L expenses are negative (shown in brackets). */
(function (root) {
    'use strict';
    var FINE = root.FINE || (typeof require === 'function' ? require('./fin-engine.js') : null);
    var I = {};

    // ── line catalogue ──
    I.SFP = [
        { id: 'PPE', sec: 'NCA', label: 'Property, plant and equipment', cf: 'capex', ref: 'IAS 16' },
        { id: 'ROU', sec: 'NCA', label: 'Right-of-use assets', cf: 'capex', ref: 'IFRS 16' },
        { id: 'INTANG', sec: 'NCA', label: 'Intangible assets', cf: 'capex', ref: 'IAS 38' },
        { id: 'INVEST', sec: 'NCA', label: 'Investments', cf: 'invest', ref: 'IFRS 9 / IAS 28' },
        { id: 'DTA', sec: 'NCA', label: 'Deferred tax assets', cf: 'tax', ref: 'IAS 12' },
        { id: 'ONCA', sec: 'NCA', label: 'Other non-current assets', cf: 'invest' },
        { id: 'INV', sec: 'CA', label: 'Inventories', cf: 'wc_inv', ref: 'IAS 2' },
        { id: 'TR', sec: 'CA', label: 'Trade and other receivables', cf: 'wc_rec', ref: 'IFRS 9' },
        { id: 'ICA', sec: 'CA', label: 'Amounts due from related parties', cf: 'wc_rec', ref: 'IAS 24' },
        { id: 'CTA', sec: 'CA', label: 'Current tax assets', cf: 'tax', ref: 'IAS 12' },
        { id: 'OCA', sec: 'CA', label: 'Other current assets', cf: 'wc_rec' },
        { id: 'CASH', sec: 'CA', label: 'Cash and cash equivalents', cf: 'cash', ref: 'IAS 7' },
        { id: 'SC', sec: 'EQ', label: 'Share capital', cf: 'equity', soce: 'SC' },
        { id: 'RES', sec: 'EQ', label: 'Other reserves', cf: 'equity', soce: 'RES' },
        { id: 'RE', sec: 'EQ', label: 'Retained earnings', cf: 'div', soce: 'RE' },
        { id: 'LTB', sec: 'NCL', label: 'Borrowings', cf: 'borrow', ref: 'IFRS 9' },
        { id: 'LL', sec: 'NCL', label: 'Lease liabilities', cf: 'lease', ref: 'IFRS 16' },
        { id: 'DTL', sec: 'NCL', label: 'Deferred tax liabilities', cf: 'tax', ref: 'IAS 12' },
        { id: 'PROVNC', sec: 'NCL', label: 'Provisions', cf: 'wc_prov', ref: 'IAS 37' },
        { id: 'ONCL', sec: 'NCL', label: 'Other non-current liabilities', cf: 'op_other' },
        { id: 'TP', sec: 'CL', label: 'Trade and other payables', cf: 'wc_pay' },
        { id: 'ICL', sec: 'CL', label: 'Amounts due to related parties', cf: 'wc_pay', ref: 'IAS 24' },
        { id: 'STB', sec: 'CL', label: 'Borrowings', cf: 'borrow', ref: 'IFRS 9' },
        { id: 'LLC', sec: 'CL', label: 'Lease liabilities', cf: 'lease', ref: 'IFRS 16' },
        { id: 'CTL', sec: 'CL', label: 'Current tax liabilities', cf: 'tax', ref: 'IAS 12' },
        { id: 'PROV', sec: 'CL', label: 'Provisions', cf: 'wc_prov', ref: 'IAS 37' },
        { id: 'OCL', sec: 'CL', label: 'Other current liabilities', cf: 'wc_pay' }
    ];
    I.SECS = { NCA: 'Non-current assets', CA: 'Current assets', EQ: 'Equity', NCL: 'Non-current liabilities', CL: 'Current liabilities' };
    I.FN = [
        { id: 'REV', label: 'Revenue', ref: 'IFRS 15' }, { id: 'COS', label: 'Cost of sales' }, { id: 'OI', label: 'Other income' },
        { id: 'DIST', label: 'Distribution and selling costs' }, { id: 'ADM', label: 'Administrative expenses' }, { id: 'OOE', label: 'Other operating expenses' },
        { id: 'FINI', label: 'Finance income' }, { id: 'FINC', label: 'Finance costs' }, { id: 'TAX', label: 'Income tax expense', ref: 'IAS 12' },
        { id: 'OCI_R', label: 'Items that may be reclassified to profit or loss', oci: true }, { id: 'OCI_N', label: 'Items that will not be reclassified to profit or loss', oci: true }
    ];
    I.NAT = [
        { id: 'REV', label: 'Revenue', ref: 'IFRS 15' }, { id: 'OI', label: 'Other income' }, { id: 'MAT', label: 'Cost of inventories and materials used' },
        { id: 'EMP', label: 'Employee benefits expense', ref: 'IAS 19' }, { id: 'DA', label: 'Depreciation and amortisation' }, { id: 'OTH', label: 'Other operating expenses' },
        { id: 'FINI', label: 'Finance income' }, { id: 'FINC', label: 'Finance costs' }, { id: 'TAX', label: 'Income tax expense', ref: 'IAS 12' },
        { id: 'OCI_R', label: 'Items that may be reclassified to profit or loss', oci: true }, { id: 'OCI_N', label: 'Items that will not be reclassified to profit or loss', oci: true }
    ];
    var byId = function (list) { var o = {}; list.forEach(function (x) { o[x.id] = x; }); return o; };
    I.SFP_BY = byId(I.SFP); I.FN_BY = byId(I.FN); I.NAT_BY = byId(I.NAT);
    var isPl = function (a) { return a.account_type === 'R' || a.account_type === 'E'; };

    /** Default IFRS lines of one account (class from Fusion / the mapping, else worked out from type + name) */
    I.defaultMap = function (a) {
        var cls = a['class'] || (FINE && FINE.classify ? FINE.classify(a) : ''), n = String(a.name || ''), t = a.account_type;
        if (t === 'R') {
            var fin = /interest (income|received|earned)|dividend (income|received)|finance income|investment income/i.test(n);
            return { fn: fin ? 'FINI' : cls === 'Other income' ? 'OI' : 'REV', nat: fin ? 'FINI' : cls === 'Other income' ? 'OI' : 'REV' };
        }
        if (t === 'E') {
            var FN = { 'Cost of sales': 'COS', Selling: 'DIST', Distribution: 'DIST', 'Finance costs': 'FINC', Tax: 'TAX' };
            var NAT = { 'Cost of sales': 'MAT', 'Staff costs': 'EMP', 'Depreciation & amortisation': 'DA', 'Finance costs': 'FINC', Tax: 'TAX' };
            var fn = FN[cls] || 'ADM', nat = NAT[cls] || 'OTH';
            if (/impairment|write.?off|loss on (sale|disposal)|exchange loss|foreign exchange/i.test(n) && fn === 'ADM') fn = 'OOE';
            if (/depreciat|amorti[sz]/i.test(n)) nat = 'DA';
            if (/salar|wage|payroll|staff|employee|pension|bonus|social sec/i.test(n) && nat === 'OTH') nat = 'EMP';
            return { fn: fn, nat: nat };
        }
        var s;
        if (t === 'A') {
            s = { Cash: 'CASH', Receivables: 'TR', Inventory: 'INV', Intangibles: 'INTANG', Intercompany: 'ICA', Suspense: 'OCA', 'Other current assets': 'OCA', 'Fixed assets': 'PPE', 'Accumulated depreciation': 'PPE' }[cls] || 'OCA';
            if ((s === 'PPE') && /right.of.use|\brou\b/i.test(n)) s = 'ROU';
            else if (s === 'PPE' && /amorti|intangib|software|goodwill/i.test(n)) s = 'INTANG';
            else if (s === 'PPE' && /investment in|associate|subsidiar|joint venture|equity securit/i.test(n)) s = 'INVEST';
            if (/deferred tax/i.test(n)) s = 'DTA';
            else if (s !== 'CASH' && /income tax (receivable|recoverable)|tax recoverable|prepaid (income )?tax|advance tax|tax paid in advance/i.test(n)) s = 'CTA';
        } else if (t === 'L') {
            s = { Payables: 'TP', Accruals: 'TP', 'Tax liabilities': 'CTL', Borrowings: 'STB', 'Long-term borrowings': 'LTB', Leases: 'LL', Intercompany: 'ICL', 'Other liabilities': 'OCL' }[cls] || 'OCL';
            if (/deferred tax/i.test(n)) s = 'DTL';
            else if (/provision/i.test(n) && s !== 'CTL') s = /long.term|non.current/i.test(n) ? 'PROVNC' : 'PROV';
            if (s === 'LL' && /current/i.test(n) && !/non.current/i.test(n)) s = 'LLC';
            if (s === 'CTL' && /\bvat\b|\bgst\b|sales tax|withholding|payroll tax|paye/i.test(n)) s = 'TP';   // indirect taxes are other payables
        } else {
            s = cls === 'Share capital' ? 'SC' : /translation|revaluation|hedg|fair value reserve|other reserve|general reserve|capital reserve|share premium|legal reserve|statutory reserve/i.test(n) && !/retained/i.test(n) ? 'RES' : 'RE';
            if (/share capital|stated capital|ordinary shares|issued capital/i.test(n)) s = 'SC';
        }
        return { sfp: s };
    };
    /** Lines of every account: defaults + overrides {sfp, fn, nat}; .auto[code] = true when nothing better than the type fallback was found */
    I.mapping = function (accounts, over) {
        over = over || {}; var out = {};
        accounts.forEach(function (a) {
            var d = I.defaultMap(a), o = {};
            if (isPl(a)) { o.fn = (over.fn || {})[a.code] || d.fn; o.nat = (over.nat || {})[a.code] || d.nat; if (I.FN_BY[o.fn] && I.FN_BY[o.fn].oci) o.nat = o.fn; }
            else o.sfp = (over.sfp || {})[a.code] || d.sfp;
            o.overridden = !!((over.sfp || {})[a.code] || (over.fn || {})[a.code] || (over.nat || {})[a.code]);
            out[a.code] = o;
        });
        return out;
    };

    // ── the pack ──
    /** data = FL.data(); period = period_seq; opts = {map, presentation 'function'|'nature', taxRate (%), shares, oci} */
    I.build = function (data, period, opts) {
        opts = opts || {};
        var pi = data._pi || (data._pi = FINE.periodIndex(data.periods || [])), L = pi.list, fa = (data.facts && data.facts.ACTUAL) || {};
        var accs = data.accounts || [], map = I.mapping(accs, opts.map), acc = {};
        accs.forEach(function (a) { acc[a.code] = a; });
        var c = pi.bySeq[period];
        if (c == null) return { error: 'The period is not loaded.' };
        var wCur = FINE.windowOf({ range: 'YTD' }, pi, period), wPy = FINE.windowOf({ range: 'YTD', at: 'PY' }, pi, period);
        var o = wCur.from - 1;                                         // previous financial year end
        var pc = wPy ? wPy.to : -1, po = wPy ? wPy.from - 1 : -1;       // same period last year, and the year end before it
        var name = function (ix) { return ix >= 0 && L[ix] ? L[ix].period_name : null; };
        // balance sheet account at an index: its closing, carried forward from the last period it has (no movement = no row)
        var bal = function (code, ix) {
            var f = fa[code]; if (!f || ix < 0) return ix < 0 && f && L[0] ? (f[L[0].period_seq] ? f[L[0].period_seq][1] - f[L[0].period_seq][0] : 0) : 0;
            for (var k = ix; k >= 0; k--) { var x = f[L[k].period_seq]; if (x) return x[1]; }
            return 0;
        };
        // income statement account: year-to-date at an index (P&L restart each financial year) and over a window
        var plEnd = function (code, ix) {                                // carried within the same financial year only
            var f = fa[code]; if (!f || ix < 0) return 0;
            for (var k = ix; k >= 0 && L[k].fiscal_year === L[ix].fiscal_year; k--) { var x = f[L[k].period_seq]; if (x) return x[1]; }
            return 0;
        };
        var ytd = function (code, w) { var f = fa[code], s = 0; if (!f || !w) return 0; for (var k = Math.max(0, w.from); k <= w.to; k++) { var x = f[L[k].period_seq]; if (x) s += x[0]; } return s; };
        var hasIx = function (ix) { return ix >= 0 && ix < L.length; };
        var codes = Object.keys(map), bs = codes.filter(function (k) { return map[k].sfp; }), pl = codes.filter(function (k) { return !map[k].sfp; });
        var reAcc = bs.filter(function (k) { return map[k].sfp === 'RE'; });

        // sums
        var bsLine = function (id, ix) { var s = 0; bs.forEach(function (k) { if (map[k].sfp === id) s += bal(k, ix); }); return s; };      // debit +
        var plLine = function (key, id, w) { var s = 0; pl.forEach(function (k) { if (map[k][key] === id) s -= ytd(k, w); }); return s; };  // credit +
        var plAllEnd = function (ix, onlyOci) { var s = 0; pl.forEach(function (k) { var oc = I.FN_BY[map[k].fn] && I.FN_BY[map[k].fn].oci; if (onlyOci == null || !!oc === onlyOci) s -= plEnd(k, ix); }); return s; };
        var profitW = function (w) { var s = 0; pl.forEach(function (k) { if (!(I.FN_BY[map[k].fn] && I.FN_BY[map[k].fn].oci)) s -= ytd(k, w); }); return s; };
        var ociW = function (w) { var s = 0; pl.forEach(function (k) { if (I.FN_BY[map[k].fn] && I.FN_BY[map[k].fn].oci) s -= ytd(k, w); }); return s; };

        // ── statement of financial position ──
        var sfpVal = function (line, ix) {
            if (!hasIx(ix)) return null;
            var d = bsLine(line.id, ix), v = line.sec === 'NCA' || line.sec === 'CA' ? d : -d;
            if (line.id === 'RE') v += plAllEnd(ix, false);                 // profit of the year so far sits in retained earnings
            if (line.id === 'RES') v += plAllEnd(ix, true);                 // other comprehensive income of the year in reserves
            return v;
        };
        var sfp = { cur: name(c), cmp: name(o), rows: [] }, tot = {};
        ['NCA', 'CA', 'EQ', 'NCL', 'CL'].forEach(function (sec) {
            sfp.rows.push({ type: 'head', label: I.SECS[sec], sec: sec });
            var t = [0, 0], anyC = hasIx(o);
            I.SFP.filter(function (l) { return l.sec === sec; }).forEach(function (l) {
                var a = sfpVal(l, c), b = sfpVal(l, o);
                if (Math.abs(a || 0) < 0.5 && Math.abs(b || 0) < 0.5) return;
                sfp.rows.push({ type: 'line', id: l.id, label: l.label, cur: a, cmp: b, ref: l.ref }); t[0] += a || 0; t[1] += b || 0;
            });
            tot[sec] = t;
            sfp.rows.push({ type: 'sub', label: 'Total ' + I.SECS[sec].toLowerCase(), cur: t[0], cmp: anyC ? t[1] : null, sec: sec });
            if (sec === 'CA') sfp.rows.push({ type: 'total', label: 'Total assets', cur: tot.NCA[0] + t[0], cmp: anyC ? tot.NCA[1] + t[1] : null });
            if (sec === 'NCL') sfp.rows.push({ type: 'sub2', label: 'Total liabilities (non-current)', skip: true });
            if (sec === 'CL') {
                sfp.rows.push({ type: 'sub', label: 'Total liabilities', cur: tot.NCL[0] + t[0], cmp: anyC ? tot.NCL[1] + t[1] : null });
                sfp.rows.push({ type: 'total', label: 'Total equity and liabilities', cur: tot.EQ[0] + tot.NCL[0] + t[0], cmp: anyC ? tot.EQ[1] + tot.NCL[1] + t[1] : null });
            }
        });
        sfp.rows = sfp.rows.filter(function (r) { return !r.skip; });
        sfp.assets = [tot.NCA[0] + tot.CA[0], tot.NCA[1] + tot.CA[1]];
        sfp.eqLiab = [tot.EQ[0] + tot.NCL[0] + tot.CL[0], tot.EQ[1] + tot.NCL[1] + tot.CL[1]];
        sfp.equity = [tot.EQ[0], tot.EQ[1]];

        // ── profit or loss and OCI ──
        var pres = opts.presentation === 'nature' ? 'nature' : 'function', key = pres === 'nature' ? 'nat' : 'fn';
        var line = function (id, w) { return plLine(key, id, w); };
        var plCalc = function (w) {
            if (!w) return null;
            var v = {}; (pres === 'nature' ? I.NAT : I.FN).forEach(function (l) { v[l.id] = line(l.id, w); });
            if (pres === 'nature') { v.OP = v.REV + v.OI + v.MAT + v.EMP + v.DA + v.OTH; }
            else { v.GP = v.REV + v.COS; v.OP = v.GP + v.OI + v.DIST + v.ADM + v.OOE; }
            v.PBT = v.OP + v.FINI + v.FINC; v.PFY = v.PBT + v.TAX; v.OCI = v.OCI_R + v.OCI_N; v.TCI = v.PFY + v.OCI;
            return v;
        };
        var pa = plCalc(wCur), pb = plCalc(wPy), shares = +opts.shares || 0;
        var plRows = pres === 'nature'
            ? [['REV'], ['OI'], ['MAT'], ['EMP'], ['DA'], ['OTH'], ['=OP', 'Operating profit'], ['FINI'], ['FINC'], ['=PBT', 'Profit before tax'], ['TAX'], ['==PFY', 'Profit for the period']]
            : [['REV'], ['COS'], ['=GP', 'Gross profit'], ['OI'], ['DIST'], ['ADM'], ['OOE'], ['=OP', 'Operating profit'], ['FINI'], ['FINC'], ['=PBT', 'Profit before tax'], ['TAX'], ['==PFY', 'Profit for the period']];
        var cat = pres === 'nature' ? I.NAT_BY : I.FN_BY;
        var plOut = { presentation: pres, cur: name(c) && wCur ? name(wCur.from) + ' – ' + name(wCur.to) : null, cmp: wPy ? name(wPy.from) + ' – ' + name(wPy.to) : null, rows: [] };
        plRows.forEach(function (r) {
            var id = r[0].replace(/^=+/, ''), type = /^==/.test(r[0]) ? 'total' : /^=/.test(r[0]) ? 'sub' : 'line';
            var a = pa[id], b = pb ? pb[id] : null;
            if (type === 'line' && Math.abs(a || 0) < 0.5 && Math.abs(b || 0) < 0.5) return;
            plOut.rows.push({ type: type, id: id, label: r[1] || cat[id].label, cur: a, cmp: b, ref: type === 'line' ? cat[id].ref : null });
        });
        plOut.rows.push({ type: 'head', label: 'Other comprehensive income' });
        plOut.rows.push({ type: 'line', id: 'OCI_R', label: I.FN_BY.OCI_R.label, cur: pa.OCI_R, cmp: pb ? pb.OCI_R : null, note: 'e.g. exchange differences on translating foreign operations (IAS 21), cash flow hedges' });
        plOut.rows.push({ type: 'line', id: 'OCI_N', label: I.FN_BY.OCI_N.label, cur: pa.OCI_N, cmp: pb ? pb.OCI_N : null, note: 'e.g. revaluation of property (IAS 16), remeasurement of defined benefit plans (IAS 19)' });
        plOut.rows.push({ type: 'sub', id: 'OCI', label: 'Other comprehensive income for the period, net of tax', cur: pa.OCI, cmp: pb ? pb.OCI : null });
        plOut.rows.push({ type: 'total', id: 'TCI', label: 'Total comprehensive income for the period', cur: pa.TCI, cmp: pb ? pb.TCI : null });
        if (shares > 0) {
            plOut.rows.push({ type: 'head', label: 'Earnings per share (IAS 33)' });
            plOut.rows.push({ type: 'eps', id: 'EPS', label: 'Basic and diluted earnings per share', cur: pa.PFY / shares, cmp: pb ? pb.PFY / shares : null });
        }
        plOut.values = { cur: pa, cmp: pb };

        // ── changes in equity ──
        var eqBlock = function (oi, ci, w) {
            if (!hasIx(oi) || !hasIx(ci) || !w) return null;
            var comp = function (id, ix) { return -bsLine(id, ix); };
            var plAt = function (ix) { return plAllEnd(ix, null); }, ociAt = function (ix) { return plAllEnd(ix, true); };
            var op = { SC: comp('SC', oi), RES: comp('RES', oi), RE: comp('RE', oi) + plAt(oi) };
            var cl = { SC: comp('SC', ci), RES: comp('RES', ci) + ociAt(ci), RE: comp('RE', ci) + plAllEnd(ci, false) };
            var pf = profitW(w), oci = ociW(w);
            var row = function (label, sc, res, re, type) { return { label: label, type: type || 'line', v: [sc, res, re, sc + res + re] }; };
            return { from: name(oi), to: name(ci), rows: [
                row('Balance at ' + name(oi), op.SC, op.RES, op.RE, 'sub'),
                row('Profit for the period', 0, 0, pf), row('Other comprehensive income', 0, oci, 0),
                row('Total comprehensive income for the period', 0, oci, pf, 'sub'),
                row('Dividends and other transactions with owners', 0, 0, cl.RE - op.RE - pf),
                row('Share capital issued and other reserve movements', cl.SC - op.SC, cl.RES - op.RES - oci, 0),
                row('Balance at ' + name(ci), cl.SC, cl.RES, cl.RE, 'total')] };
        };
        var soce = { cols: ['Share capital', 'Other reserves', 'Retained earnings', 'Total equity'], blocks: [eqBlock(po, pc, wPy), eqBlock(o, c, wCur)].filter(Boolean) };

        // ── cash flows (indirect) ──
        var cfFor = function (oi, ci, w) {
            if (!hasIx(oi) || !hasIx(ci) || !w) return null;
            var eff = function (cfKey) { var s = 0; I.SFP.filter(function (l) { return l.cf === cfKey; }).forEach(function (l) { s -= bsLine(l.id, ci) - bsLine(l.id, oi); }); return s; };
            var natW = function (id) { return plLine('nat', id, w); }, fnW = function (id) { return plLine('fn', id, w); };
            var v = pres === 'nature' ? plCalc(w) : plCalc(w), da = -natW('DA'), fc = -fnW('FINC'), fi = fnW('FINI'), tax = -fnW('TAX');
            var pbt = v.PBT, profitO = plAllEnd(oi, null);
            var r = {};
            r.pbt = pbt; r.da = da; r.fc = fc; r.fi = -fi;
            r.wc_inv = eff('wc_inv'); r.wc_rec = eff('wc_rec'); r.wc_pay = eff('wc_pay'); r.wc_prov = eff('wc_prov'); r.op_other = eff('op_other') + v.OCI;
            r.gen = r.pbt + r.da + r.fc + r.fi + r.wc_inv + r.wc_rec + r.wc_pay + r.wc_prov + r.op_other;
            r.tax = -tax + eff('tax');
            r.op = r.gen + r.tax;
            r.capex = eff('capex') - da; r.invest = eff('invest'); r.intRec = fi;
            r.inv = r.capex + r.invest + r.intRec;
            r.borrow = eff('borrow'); r.lease = eff('lease'); r.equity = eff('equity'); r.div = eff('div') - profitO; r.intPaid = -fc;
            r.fin = r.borrow + r.lease + r.equity + r.div + r.intPaid;
            r.net = r.op + r.inv + r.fin;
            r.open = bsLine('CASH', oi); r.close = bsLine('CASH', ci); r.diff = r.close - (r.open + r.net);
            return r;
        };
        var cfa = cfFor(o, c, wCur), cfb = cfFor(po, pc, wPy);
        var cfRows = [['head', 'Cash flows from operating activities'], ['pbt', 'Profit before tax'], ['head2', 'Adjustments for:'], ['da', 'Depreciation and amortisation'], ['fc', 'Finance costs'], ['fi', 'Finance income'],
            ['wc_inv', '(Increase) / decrease in inventories'], ['wc_rec', '(Increase) / decrease in trade and other receivables'], ['wc_pay', 'Increase / (decrease) in trade and other payables'],
            ['wc_prov', 'Increase / (decrease) in provisions'], ['op_other', 'Other non-cash movements'], ['=gen', 'Cash generated from operations'], ['tax', 'Income tax paid'], ['==op', 'Net cash from operating activities'],
            ['head', 'Cash flows from investing activities'], ['capex', 'Purchase of property, plant and equipment and intangible assets (net)'], ['invest', 'Investments and other non-current assets'], ['intRec', 'Interest received'], ['==inv', 'Net cash from investing activities'],
            ['head', 'Cash flows from financing activities'], ['borrow', 'Proceeds from / (repayment of) borrowings'], ['lease', 'Payment of lease liabilities'], ['equity', 'Share capital and reserves'], ['div', 'Dividends paid and other movements in retained earnings'], ['intPaid', 'Interest paid'], ['==fin', 'Net cash from financing activities'],
            ['=net', 'Net increase / (decrease) in cash and cash equivalents'], ['open', 'Cash and cash equivalents at the beginning of the period'], ['==close', 'Cash and cash equivalents at the end of the period']];
        var cf = { cur: plOut.cur, cmp: plOut.cmp, rows: [], values: { cur: cfa, cmp: cfb } };
        cfRows.forEach(function (r) {
            if (/^head/.test(r[0])) { cf.rows.push({ type: r[0] === 'head' ? 'head' : 'head2', label: r[1] }); return; }
            var id = r[0].replace(/^=+/, ''), type = /^==/.test(r[0]) ? 'total' : /^=/.test(r[0]) ? 'sub' : 'line';
            var a = cfa ? cfa[id] : null, b = cfb ? cfb[id] : null;
            if (type === 'line' && Math.abs(a || 0) < 0.5 && Math.abs(b || 0) < 0.5 && id !== 'pbt') return;
            cf.rows.push({ type: type, id: id, label: r[1], cur: a, cmp: b });
        });

        // ── note data ──
        var notes = {};
        notes.nature = I.NAT.filter(function (l) { return !l.oci; }).map(function (l) { return { id: l.id, label: l.label, cur: plLine('nat', l.id, wCur), cmp: wPy ? plLine('nat', l.id, wPy) : null }; })
            .filter(function (r) { return Math.abs(r.cur || 0) >= 0.5 || Math.abs(r.cmp || 0) >= 0.5; });
        notes.revenue = pl.filter(function (k) { return map[k].fn === 'REV'; }).map(function (k) { return { code: k, label: (acc[k] || {}).name || k, cur: -ytd(k, wCur), cmp: wPy ? -ytd(k, wPy) : null }; })
            .filter(function (r) { return Math.abs(r.cur) >= 0.5 || Math.abs(r.cmp || 0) >= 0.5; }).sort(function (a, b) { return b.cur - a.cur; });
        // PPE / ROU / intangibles: opening NBV, additions (derived), depreciation, closing NBV; cost vs accumulated depreciation at closing
        var daBy = { PPE: 0, ROU: 0, INTANG: 0 };
        pl.forEach(function (k) { if (map[k].nat !== 'DA') return; var n = String((acc[k] || {}).name || ''), t = /amorti|intangib|software/i.test(n) ? 'INTANG' : /right.of.use|\brou\b|lease/i.test(n) ? 'ROU' : 'PPE'; daBy[t] += ytd(k, wCur); });
        notes.assets = ['PPE', 'ROU', 'INTANG'].map(function (id) {
            var op = hasIx(o) ? bsLine(id, o) : null, cl = bsLine(id, c), cost = 0, accd = 0;
            bs.forEach(function (k) { if (map[k].sfp !== id) return; var b = bal(k, c), cls = (acc[k] || {})['class'] || FINE.classify(acc[k]); if (cls === 'Accumulated depreciation' || b < 0) accd += b; else cost += b; });
            return { id: id, label: I.SFP_BY[id].label, opening: op, additions: op == null ? null : cl - op + daBy[id], depreciation: -daBy[id], closing: cl, cost: cost, accumulated: accd };
        }).filter(function (r) { return Math.abs(r.closing) >= 0.5 || Math.abs(r.opening || 0) >= 0.5; });
        var rate = opts.taxRate != null && opts.taxRate !== '' ? +opts.taxRate : null;
        notes.tax = { pbt: pa.PBT, expense: -pa.TAX, rate: rate, expected: rate == null ? null : pa.PBT * rate / 100, effective: pa.PBT ? -pa.TAX / pa.PBT * 100 : null,
            current: { cta: sfpVal(I.SFP_BY.CTA, c), ctl: sfpVal(I.SFP_BY.CTL, c), dta: sfpVal(I.SFP_BY.DTA, c), dtl: sfpVal(I.SFP_BY.DTL, c) } };
        if (rate != null) notes.tax.other = notes.tax.expense - notes.tax.expected;
        notes.debt = ['LTB', 'STB', 'LL', 'LLC'].map(function (id) { var l = I.SFP_BY[id]; return { id: id, label: l.label + (l.sec === 'CL' ? ' — current' : ' — non-current'), cur: sfpVal(l, c), cmp: sfpVal(l, o) }; })
            .filter(function (r) { return Math.abs(r.cur || 0) >= 0.5 || Math.abs(r.cmp || 0) >= 0.5; });
        notes.related = bs.filter(function (k) { return map[k].sfp === 'ICA' || map[k].sfp === 'ICL'; }).map(function (k) {
            var a = map[k].sfp === 'ICA' ? 1 : -1; return { code: k, label: (acc[k] || {}).name || k, side: map[k].sfp === 'ICA' ? 'Receivable' : 'Payable', cur: a * bal(k, c), cmp: hasIx(o) ? a * bal(k, o) : null };
        }).filter(function (r) { return Math.abs(r.cur) >= 0.5 || Math.abs(r.cmp || 0) >= 0.5; });
        notes.receivables = { gl: sfpVal(I.SFP_BY.TR, c), glCmp: sfpVal(I.SFP_BY.TR, o) };
        notes.eps = shares > 0 ? { shares: shares, profit: pa.PFY, basic: pa.PFY / shares, cmp: pb ? pb.PFY / shares : null } : null;

        // ── checks ──
        var checks = [], ok = function (b, label, detail, sev) { checks.push({ ok: !!b, label: label, detail: detail || '', sev: sev || 'error' }); };
        var tb = 0; codes.forEach(function (k) { tb += map[k].sfp ? bal(k, c) : plEnd(k, c); });
        ok(Math.abs(tb) < 1, 'The trial balance balances at ' + name(c), 'debits − credits = ' + Math.round(tb));
        ok(Math.abs(sfp.assets[0] - sfp.eqLiab[0]) < 1, 'Total assets = total equity and liabilities (' + name(c) + ')', 'difference ' + Math.round(sfp.assets[0] - sfp.eqLiab[0]));
        if (hasIx(o)) ok(Math.abs(sfp.assets[1] - sfp.eqLiab[1]) < 1, 'Total assets = total equity and liabilities (' + name(o) + ')', 'difference ' + Math.round(sfp.assets[1] - sfp.eqLiab[1]));
        ok(hasIx(o), 'Comparative balance sheet (previous year end ' + (name(o) || '—') + ') is loaded', 'IAS 1.38: comparative information for the preceding period — sync the last period of the previous year');
        ok(!!wPy, 'Comparative income statement (same period last year) is loaded', 'IAS 1.38 / IAS 34.20 — sync the same months of last year', 'warn');
        if (cfa) ok(Math.abs(cfa.diff) < 1, 'The cash flow statement ties to the change in cash', 'unexplained ' + Math.round(cfa.diff) + ' — accounts outside the trial balance or a TB that does not balance');
        var lastSoce = soce.blocks[soce.blocks.length - 1];
        if (lastSoce) ok(Math.abs(lastSoce.rows[lastSoce.rows.length - 1].v[3] - sfp.equity[0]) < 1, 'Changes in equity close to the equity in the balance sheet', '');
        var susp = bs.filter(function (k) { return ((acc[k] || {})['class'] || FINE.classify(acc[k])) === 'Suspense' && Math.abs(bal(k, c)) >= 0.5; });
        ok(!susp.length, 'No balances on suspense / clearing accounts', susp.slice(0, 5).join(', ') + (susp.length > 5 ? ' …' : ''), 'warn');
        var cashNeg = sfpVal(I.SFP_BY.CASH, c) < 0;
        ok(!cashNeg, 'Cash and cash equivalents are not negative', 'a bank overdraft is presented in borrowings unless it is part of cash management (IAS 7.8)', 'warn');
        var negLines = sfp.rows.filter(function (r) { return r.type === 'line' && r.cur < -0.5 && r.id !== 'RE' && r.id !== 'RES'; }).map(function (r) { return r.label; });
        ok(!negLines.length, 'No line shows the wrong sign', negLines.join(', '), 'warn');
        ok(pres === 'nature' || notes.nature.length > 0, 'Expenses by nature are disclosed (IAS 1.104, function presentation)', '', 'warn');
        ok(shares > 0, 'Earnings per share (IAS 33) — number of shares set', 'set the weighted average number of ordinary shares in Settings', 'warn');
        ok(rate != null, 'Income tax reconciliation (IAS 12.81(c)) — statutory rate set', 'set the tax rate in Settings', 'warn');

        return { period: name(c), periodSeq: period, cmpPeriod: name(o), pyPeriod: name(pc), sfp: sfp, pl: plOut, soce: soce, cf: cf, notes: notes, checks: checks, map: map };
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = I; else root.FIFRS = I;
})(typeof window !== 'undefined' ? window : this);

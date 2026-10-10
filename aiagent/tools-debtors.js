/* AI Agent — Debtors Desk tools (page side): the Fusion Debtors Control module's own store and engine (../debtors/dc-store.js
   = window.DCS, ../debtors/dc-engine.js + dc-cycle.js = window.DCE) — the same reads the Debtors pages make, so an answer here
   matches what the user sees there. Read-only: sending statements or changing records stays in the Debtors page.
   dc_open asks the page that embeds the agent (Debtors › Autopilot) to open a customer / cycle / tab. */
(function () {
    if (!window.DCS || !window.DCE) return;           // the module's scripts are not shipped in this release
    var S = window.DCS, E = window.DCE, _bus = null;

    function today() { var d = new Date(), z = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
    function addDays(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); var z = function (x) { return ('0' + x).slice(-2); }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
    function num(v) { return v == null || v === '' ? null : +v; }
    function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }
    function words(s) { return String(s || '').toLowerCase().split(/\s+/).filter(Boolean); }
    function hit(text, ws) { var t = String(text || '').toLowerCase(); return ws.every(function (w) { return t.indexOf(w) >= 0; }); }

    /** the business units set up in Debtors (Setup), else the two of the old form */
    function bus() {
        if (_bus) return Promise.resolve(_bus);
        return S.settings.get('BUS').catch(function () { return null; }).then(function (v) { _bus = (v && v.length ? v : E.SEED_BUS).map(function (b) { return E.normBu ? E.normBu(b) : b; }); return _bus; });
    }
    function buOf(q) {
        return bus().then(function (list) {
            if (!q) return list[0];
            var s = String(q).toLowerCase();
            return list.filter(function (b) { return String(b.id) === String(q); })[0] || list.filter(function (b) { return String(b.name || '').toLowerCase().indexOf(s) >= 0; })[0] || list[0];
        });
    }
    /** the latest archived cycle of a BU → its balance rows, else the latest statement per customer */
    function balances(b) {
        return S.cycle.list().catch(function () { return []; }).then(function (cys) {
            var cy = cys.filter(function (c) { return String(c.BU_ID) === String(b.id) && c.SNAP_AT; }).sort(function (a, c) { return String(c.PERIOD).localeCompare(String(a.PERIOD)); })[0];
            if (cy) return S.cycle.bal(cy.CYCLE_ID).then(function (rows) {
                return { source: 'statement cycle ' + cy.PERIOD + ' (archived ' + cy.SNAP_AT + ', balances as at ' + cy.STMT_DATE + ')', rows: rows.map(function (r) {
                    return { account: r.ACCOUNT_NUMBER, name: r.ACCOUNT_NAME, currency: r.CURRENCY, balance: +r.BALANCE || 0, overdue: num(r.OVERDUE), d60: num(r.D60), d90: num(r.D90), d90p: num(r.D90P), items: num(r.ITEMS_N), email: r.EMAIL, delivery: r.DELIVERY, prev: num(r.PREV_BALANCE) };
                }) };
            });
            return S.stmt.latest(b.id).then(function (rows) {
                return { source: 'the latest statement per customer (no archived cycle yet)', rows: rows.map(function (r) {
                    var a = null; try { a = r.AGING_JSON ? JSON.parse(r.AGING_JSON) : null; } catch (e) { }
                    return { account: r.ACCOUNT_NUMBER, name: r.ACCOUNT_NAME, currency: r.CURRENCY, balance: +r.BALANCE || 0, overdue: num(r.OVERDUE), d60: a ? a.d60 : null, d90: a ? a.d90 : null, d90p: a ? a.d90p : null, items: null, email: r.EMAIL_TO, delivery: r.DELIVERY, asAt: r.STMT_DATE };
                }) };
            });
        });
    }

    AG.tool('dc_debtors', function (inp) {
        return buOf(inp.bu).then(function (b) {
            return balances(b).then(function (bal) {
                var ws = words(inp.words), od = +inp.overdue_days || 0;
                var list = bal.rows.filter(function (r) {
                    if (inp.credit && !(r.balance < 0)) return false;
                    if (!inp.credit && inp.min_balance != null && r.balance < +inp.min_balance) return false;
                    if (ws.length && !hit(r.account + ' ' + r.name, ws)) return false;
                    if (od >= 90 && !(r.d90p > 0)) return false;
                    if (od >= 60 && od < 90 && !((r.d90 || 0) + (r.d90p || 0) > 0)) return false;
                    if (od >= 30 && od < 60 && !(r.overdue > 0)) return false;
                    return true;
                });
                var key = inp.sort === 'over_90' || od >= 90 ? 'd90p' : inp.sort === 'overdue' ? 'overdue' : 'balance';
                list.sort(function (a, c) { return inp.credit ? a.balance - c.balance : (c[key] || 0) - (a[key] || 0); });
                var top = list.slice(0, Math.min(+inp.top || 20, 500)), tot = list.reduce(function (s, r) { return s + r.balance; }, 0);
                var out = AG.tableOut(b.name + ' · ' + (inp.credit ? 'customers in credit' : od ? 'over ' + od + ' days' : 'top debtors'), top.map(function (r) {
                    return { Account: r.account, Customer: r.name, Balance: r2(r.balance), Overdue: r2(r.overdue), '61-90': r2(r.d90), 'Over 90': r2(r.d90p), Items: r.items, 'Goes to': r.delivery === 'POST' ? 'post' : r.email, 'Last balance': r.prev != null ? r2(r.prev) : null };
                }), 'No customer matches in ' + b.name + ' (' + bal.source + ').');
                if (out.data) out.content = JSON.stringify({ business_unit: b.name, currency: b.currency || (top[0] || {}).currency, source: bal.source, matching_customers: list.length, total_of_matching: r2(tot), shown: top.length, result: out.data });
                return out;
            });
        });
    });

    AG.tool('dc_customer', function (inp) {
        return buOf(inp.bu).then(function (b) {
            return balances(b).then(function (bal) {
                var ws = words(inp.words), acct = String(inp.account || '').trim();
                var c = acct ? bal.rows.filter(function (r) { return String(r.account).toUpperCase() === acct.toUpperCase(); })[0] : ws.length ? bal.rows.filter(function (r) { return hit(r.account + ' ' + r.name, ws); })[0] : null;
                acct = acct || (c && c.account);
                if (!acct) return { ok: true, content: 'No customer found for "' + (inp.words || '') + '" in ' + b.name + '. Try the account number, or dc_debtors with words.' };
                return Promise.all([S.cust.list(b.id).catch(function () { return []; }), S.stmt.search({ buId: b.id, account: acct, limit: 6 }).catch(function () { return []; }), S.act.list({ buId: b.id, account: acct, open: true, limit: 50 }).catch(function () { return []; })]).then(function (r) {
                    var card = r[0].filter(function (x) { return x.ACCOUNT_NUMBER === acct; })[0] || null;
                    return { ok: true, content: JSON.stringify({
                        business_unit: b.name, account: acct, name: (c && c.name) || (card && card.ACCOUNT_NAME) || (r[1][0] || {}).ACCOUNT_NAME || '',
                        balance: c ? { amount: r2(c.balance), overdue: r2(c.overdue), over_90: r2(c.d90p), source: bal.source } : null,
                        card: card ? { statement_email: card.STMT_TO, cc: card.STMT_CC, delivery: card.DELIVERY, collector: card.OWNER_USER, phone: card.PHONE, contact: card.CONTACT_NAME, tags: card.TAGS, on_hold: card.ON_HOLD === 'Y', notes: card.NOTES } : null,
                        last_statements: r[1].map(function (s) { return { as_at: s.STMT_DATE, balance: r2(+s.BALANCE), state: E.stmtState(s).label, to: s.EMAIL_TO || s.DELIVERY, sent: s.SENT_AT || s.CREATED_AT, answer: s.RESP_STATUS || null, comment: s.RESP_COMMENT || null }; }),
                        open_items: r[2].map(function (a) { return { kind: a.KIND, subject: a.SUBJECT, amount: num(a.AMOUNT), due: a.DUE_DATE, for: a.ASSIGNED_TO, created: a.CREATED_AT }; }),
                        tip: 'dc_open_items reads the open invoices live from Fusion; dc_open what=customer shows the customer to the user.'
                    }) };
                });
            });
        });
    });

    AG.tool('dc_open_items', function (inp) {
        return buOf(inp.bu).then(function (b) {
            var sql = E.openItemsSql(b, inp.account);
            return S.fusionSql(sql, 5000, 300000).then(function (rows) {
                var t = E.openItemsSummary(rows);
                var out = AG.tableOut(inp.account + ' · open items', rows.map(function (r) { return { Type: r.TRX_TYPE || r.CLASS, Number: r.TRX_NUMBER, Date: r.TRX_DATE, Due: r.DUE_DATE, 'Days late': num(r.DAYS_LATE), Original: num(r.ORIGINAL), Open: num(r.REMAINING), Currency: r.CURRENCY, Reference: r.REFERENCE || r.CUSTOMER_PO }; }), 'Nothing open in Fusion for ' + inp.account + '.');
                if (out.data) out.content = JSON.stringify({ customer: t.name, open_total: t.total, overdue: t.overdue, credits: t.credits, oldest_days_late: t.oldest, aging: t.aging, items: t.n, result: out.data });
                return out;
            });
        });
    });

    AG.tool('dc_statements', function (inp) {
        return (inp.bu ? buOf(inp.bu) : Promise.resolve(null)).then(function (b) {
            var days = Math.min(+inp.days || 30, 400), st = String(inp.status || '').toUpperCase();
            var f = { from: inp.stmt_date ? null : addDays(today(), -days), stmtDate: inp.stmt_date || null, account: inp.account || null, buId: b ? b.id : null, limit: 3000 };
            if (st === 'FAILED' || st === 'POSTED' || st === 'SENT') f.status = st === 'SENT' ? null : st;
            return S.stmt.search(f).then(function (list) {
                list = list.filter(function (s) {
                    var k = E.stmtState(s).key;
                    if (!st) return true;
                    if (st === 'NOT_OPENED') return s.STATUS === 'SENT' && !(+s.OPENS > 0) && !s.READ_AT;
                    if (st === 'SENT') return s.STATUS === 'SENT';
                    return k === st;
                });
                return AG.tableOut('Statements' + (st ? ' · ' + st.toLowerCase().replace('_', ' ') : '') + (inp.stmt_date ? ' · as at ' + inp.stmt_date : ' · last ' + days + ' days'), list.slice(0, 500).map(function (s) {
                    return { When: s.SENT_AT || s.CREATED_AT, 'As at': s.STMT_DATE, Account: s.ACCOUNT_NUMBER, Customer: s.ACCOUNT_NAME, Balance: r2(+s.BALANCE), State: E.stmtState(s).label, To: s.EMAIL_TO || s.DELIVERY, Error: s.ERROR_TEXT || s.BOUNCE_TEXT || null, Answer: s.RESP_COMMENT || null, By: s.APP_USER };
                }), 'No statement matches.');
            });
        });
    });

    AG.tool('dc_followups', function (inp) {
        var kind = String(inp.kind || 'ALL').toUpperCase(), t = today(), wk = addDays(t, 7), me = S.user().toLowerCase();
        return S.act.list({ open: true, account: inp.account || null, kinds: kind === 'ALL' ? null : [kind], limit: 3000 }).then(function (list) {
            list = list.filter(function (a) {
                if (a.KIND === 'CONFIRM') return false;
                if (inp.mine && String(a.ASSIGNED_TO || a.CREATED_BY || '').toLowerCase() !== me) return false;
                if (inp.due === 'late') return a.DUE_DATE && a.DUE_DATE < t;
                if (inp.due === 'today') return a.DUE_DATE === t;
                if (inp.due === 'week') return a.DUE_DATE && a.DUE_DATE <= wk;
                return true;
            }).sort(function (a, c) { return String(a.DUE_DATE || '9999').localeCompare(String(c.DUE_DATE || '9999')); });
            return AG.tableOut('Open follow-ups' + (kind !== 'ALL' ? ' · ' + kind.toLowerCase() : '') + (inp.due && inp.due !== 'all' ? ' · ' + inp.due : ''), list.slice(0, 500).map(function (a) {
                return { Kind: a.KIND, Account: a.ACCOUNT_NUMBER, Customer: a.ACCOUNT_NAME, Subject: a.SUBJECT, Amount: num(a.AMOUNT), Due: a.DUE_DATE, Late: a.DUE_DATE && a.DUE_DATE < t ? 'yes' : '', For: a.ASSIGNED_TO || a.CREATED_BY, Created: a.CREATED_AT };
            }), 'Nothing open.');
        });
    });

    AG.tool('dc_cycle', function (inp) {
        return S.cycle.list().then(function (cys) {
            return (inp.bu ? buOf(inp.bu) : Promise.resolve(null)).then(function (b) {
                var cy = cys.filter(function (c) { return (!inp.cycle_id || c.CYCLE_ID === inp.cycle_id) && (!b || String(c.BU_ID) === String(b.id)) && (!inp.period || c.PERIOD === inp.period); })[0];
                if (!cy) return { ok: true, content: 'No statement cycle found' + (inp.period ? ' for ' + inp.period : '') + '. Cycles: ' + cys.slice(0, 10).map(function (c) { return c.PERIOD + ' ' + c.BU_NAME + ' (' + c.STATUS + ')'; }).join('; ') };
                return S.cycle.checks(cy.CYCLE_ID).catch(function () { return []; }).then(function (ck) {
                    var steps = E.cycleSteps(cy).steps.map(function (s) { return s.key + ': ' + s.state; });
                    return { ok: true, content: JSON.stringify({
                        cycle_id: cy.CYCLE_ID, title: cy.TITLE, business_unit: cy.BU_NAME, period: cy.PERIOD, statements_as_at: cy.STMT_DATE, status: cy.STATUS, owner: cy.OWNER_USER, due: cy.DUE_DATE, steps: steps,
                        checklist: { done_at: cy.CHECKS_AT, score: num(cy.CHECKS_SCORE) }, archive: cy.SNAP_AT ? { at: cy.SNAP_AT, customers: num(cy.CUSTOMERS), total_due: num(cy.TOTAL_DUE), overdue: num(cy.OVERDUE), over_90: num(cy.D90P), in_credit: num(cy.CREDIT_N) } : null,
                        statement_check: cy.REVIEW_AT ? { at: cy.REVIEW_AT, by: cy.REVIEW_BY, note: cy.REVIEW_NOTE, query_changed: cy.STMT_CHANGED === 'Y' } : null,
                        sent: { emailed: num(cy.SENT_N), posted: num(cy.POSTED_N), failed: num(cy.FAILED_N), coverage_pct: num(cy.COVER_PCT) }, closed: cy.CLOSED_AT ? { at: cy.CLOSED_AT, by: cy.CLOSED_BY, note: cy.CLOSE_NOTE } : null,
                        checks: ck.map(function (c) { return { check: c.TITLE, severity: c.SEVERITY, status: c.STATUS, rows: num(c.ROWS_N), amount: num(c.AMOUNT), error: c.ERROR_TEXT, bypassed_by: c.BYPASS_BY, bypass_note: c.BYPASS_NOTE }; })
                    }) };
                });
            });
        });
    });

    /** ask the page that embeds the agent to show something (Debtors › Autopilot); standalone, say where to find it */
    AG.tool('dc_open', function (inp) {
        var emb = window.AG_EMBED;
        if (!emb || emb.module !== 'debtors') return Promise.resolve({ ok: true, content: 'The user is not in the Debtors page - tell them: open Fusion Debtors Control (Home › Finance) ' + (inp.what === 'customer' ? '› Customers › ' + inp.account : '') + '.' });
        return buOf(inp.bu).then(function (b) {
            emb.toParent({ __agModule: 1, op: 'open', what: inp.what, account: inp.account || null, bu: b ? b.id : null, cycle_id: inp.cycle_id || null, tab: inp.tab || null });
            return { ok: true, content: 'Opened ' + (inp.what === 'customer' ? 'customer ' + inp.account : inp.what === 'cycle' ? 'the cycle' : 'the ' + inp.tab + ' tab') + ' in the Debtors page for the user.' };
        });
    });
    Object.assign(AG.LABELS, { dc_debtors: 'Debtors', dc_customer: 'Customer', dc_open_items: 'Open invoices (Fusion)', dc_statements: 'Statements', dc_followups: 'Follow-ups', dc_cycle: 'Statement cycle', dc_open: 'Open in Debtors' });
    Object.assign(AG.ICONS, { dc_debtors: 'fa-file-invoice-dollar', dc_customer: 'fa-user', dc_open_items: 'fa-receipt', dc_statements: 'fa-envelope-open-text', dc_followups: 'fa-list-check', dc_cycle: 'fa-arrows-rotate', dc_open: 'fa-up-right-from-square' });
})();

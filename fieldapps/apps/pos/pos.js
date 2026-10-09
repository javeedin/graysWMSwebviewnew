/* Field Apps · POS — the till UI. Pure engine in pos-engine.js (on om/om-engine.js); this file is the screens.
 * Runs inside the Field Apps runtime shell: everything outside the page goes through the FA SDK
 * (FA.query for the catalogue, FA.submit for sales and shifts, FA.print for receipts, FA.store for this device's data). */
(function () {
    'use strict';
    var S = { ctx: null, set: null, items: [], customers: [], rules: [], catAt: 0, cats: [], shift: null, sale: null, parked: [], sales: [], seq: 1,
        view: 'start', cartOpen: false, q: '', cat: '', lang: 'en', dark: false, online: true, busy: '', entry: '', pay: null, sheet: null, menu: false,
        custQ: '', ret: null, detail: null, lastAdd: '', prefs: {}, loading: true, toastT: null, catBusy: false };
    var $app = document.getElementById('app');
    var I18N = {
        en: { pos: 'POS', start: 'Open the till', openShift: 'Open shift', cont: 'Continue', float: 'Cash float', catalog: 'Catalogue', items: 'items', customers: 'customers', rules: 'discount rules', updated: 'updated', never: 'never', update: 'Update', updating: 'Updating…', offline: 'offline', online: 'online',
            search: 'Search or scan…', all: 'All', cart: 'Cart', empty: 'Nothing yet — tap an item or scan', subtotal: 'Subtotal', discount: 'Discount', vat: 'VAT', deposits: 'Deposits', crates: 'Crates', rounding: 'Rounding', total: 'TOTAL', pay: 'Pay', park: 'Park', customer: 'Customer', walkin: 'Walk-in', clear: 'Clear',
            qty: 'Quantity', disc: 'Discount %', note: 'Note', remove: 'Remove', done: 'Done', cancel: 'Cancel', due: 'To pay', refund: 'Refund', paid: 'Paid', change: 'Change', addPay: 'Add payment', exact: 'Exact', complete: 'Complete sale', completeRet: 'Complete refund', ref: 'Reference', receipt: 'Receipt', print: 'Print', newSale: 'New sale', sent: 'sent', queued: 'waiting to send', failed: 'not sent',
            sales: 'Sales today', noSales: 'No sales yet today', ret: 'Return', shift: 'Shift', xreport: 'Shift so far', payout: 'Cash out', closeShift: 'Close shift', counted: 'Cash counted', expected: 'Expected in drawer', variance: 'Difference', confirmClose: 'Close the shift', settings: 'Settings', language: 'Language', dark: 'Dark mode', cols: 'Receipt width', copies: 'Receipt copies', testPrint: 'Print a test', clearCat: 'Clear the catalogue', about: 'About', lock: 'Lock', parked: 'Parked sales', noParked: 'No parked sales', resume: 'Resume', del: 'Delete',
            needShift: 'Open a shift first', added: 'Added', notFound: 'No item for', tooMany: 'Several items match — pick one', noCat: 'No catalogue on this phone yet — update it when online', maxDisc: 'Discount over the allowed {n}%', noCust: 'On account needs a customer', refundOut: 'Refund must be paid out in full', retPick: 'Pick what comes back', retQty: 'Refund {n}', reason: 'Reason', sold: 'sold', pending: '{n} waiting to send', voidQ: 'Clear this sale?', closeQ: 'Close the shift now? Sales will be sent and the till locked.', back: 'Back', of: 'of', items2: 'Items', noCustomer: 'No customer', credit: 'Credit', creditLimit: 'credit limit', mobile: 'Mobile money', card: 'Card', cash: 'Cash', account: 'On account' },
        fr: { pos: 'Caisse', start: 'Ouvrir la caisse', openShift: 'Ouvrir la session', cont: 'Continuer', float: 'Fond de caisse', catalog: 'Catalogue', items: 'articles', customers: 'clients', rules: 'règles de remise', updated: 'mis à jour', never: 'jamais', update: 'Mettre à jour', updating: 'Mise à jour…', offline: 'hors ligne', online: 'en ligne',
            search: 'Rechercher ou scanner…', all: 'Tous', cart: 'Panier', empty: 'Rien pour l’instant — touchez un article ou scannez', subtotal: 'Sous-total', discount: 'Remise', vat: 'TVA', deposits: 'Consignes', crates: 'Casiers', rounding: 'Arrondi', total: 'TOTAL', pay: 'Payer', park: 'Mettre de côté', customer: 'Client', walkin: 'Comptoir', clear: 'Vider',
            qty: 'Quantité', disc: 'Remise %', note: 'Note', remove: 'Retirer', done: 'OK', cancel: 'Annuler', due: 'À payer', refund: 'Remboursement', paid: 'Payé', change: 'Rendu', addPay: 'Ajouter le paiement', exact: 'Exact', complete: 'Terminer la vente', completeRet: 'Terminer le remboursement', ref: 'Référence', receipt: 'Reçu', print: 'Imprimer', newSale: 'Nouvelle vente', sent: 'envoyé', queued: 'en attente d’envoi', failed: 'non envoyé',
            sales: 'Ventes du jour', noSales: 'Pas encore de vente aujourd’hui', ret: 'Retour', shift: 'Session', xreport: 'Session en cours', payout: 'Sortie de caisse', closeShift: 'Clôturer', counted: 'Espèces comptées', expected: 'Attendu en caisse', variance: 'Écart', confirmClose: 'Clôturer la session', settings: 'Réglages', language: 'Langue', dark: 'Mode sombre', cols: 'Largeur du reçu', copies: 'Copies du reçu', testPrint: 'Imprimer un test', clearCat: 'Effacer le catalogue', about: 'À propos', lock: 'Verrouiller', parked: 'Ventes de côté', noParked: 'Aucune vente de côté', resume: 'Reprendre', del: 'Supprimer',
            needShift: 'Ouvrez d’abord une session', added: 'Ajouté', notFound: 'Aucun article pour', tooMany: 'Plusieurs articles — choisissez', noCat: 'Pas de catalogue sur ce téléphone — mettez-le à jour en ligne', maxDisc: 'Remise au-delà des {n}% permis', noCust: 'Le compte client exige un client', refundOut: 'Le remboursement doit être payé en entier', retPick: 'Choisissez ce qui revient', retQty: 'Rembourser {n}', reason: 'Motif', sold: 'vendu', pending: '{n} en attente d’envoi', voidQ: 'Vider cette vente ?', closeQ: 'Clôturer maintenant ? Les ventes seront envoyées et la caisse verrouillée.', back: 'Retour', of: 'sur', items2: 'Articles', noCustomer: 'Sans client', credit: 'Crédit', creditLimit: 'limite de crédit', mobile: 'Paiement mobile', card: 'Carte', cash: 'Espèces', account: 'Sur compte' }
    };
    function t(k, a) { var s = (I18N[S.lang] && I18N[S.lang][k]) || I18N.en[k] || k; if (a) Object.keys(a).forEach(function (x) { s = s.replace('{' + x + '}', a[x]); }); return s; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function money(n) { return POSE.money(n, S.set); }
    function num(v) { return POSE.roundCash(+String(v || '0').replace(/,/g, '') || 0, 0); }
    function today() { return POSE.nowIso().slice(0, 10); }
    function hm(iso) { return iso ? String(iso).slice(11, 16) : ''; }
    function ctxE() { return { settings: S.set, rules: S.rules, device: S.ctx.device, nextNumber: S.seq }; }
    function tenderLabel(code) { var k = { CASH: 'cash', CARD: 'card', MOBILE: 'mobile', CREDIT: 'account' }[code]; return k ? t(k) : code; }
    function tenders() { return POSE.tenderList(S.set); }

    // ── storage ───────────────────────────────────────────────────
    function sget(k) { return FA.store.get(k); }
    function sset(k, v) { return FA.store.set(k, v); }
    function persist() { return Promise.all([sset('sale', S.sale), sset('parked', S.parked), sset('shift', S.shift), sset('seq', S.seq), sset('sales:' + today(), S.sales), sset('prefs', S.prefs)]); }
    function load() {
        return Promise.all([sget('catalog'), sget('shift'), sget('sales:' + today()), sget('parked'), sget('seq'), sget('prefs'), sget('sale')]).then(function (r) {
            var c = r[0] || {};
            S.items = c.items || []; S.customers = c.customers || []; S.rules = c.rules || []; S.catAt = c.at || 0; cats();
            S.shift = r[1] || null; S.sales = r[2] || []; S.parked = r[3] || []; S.seq = r[4] || 1; S.prefs = r[5] || {}; S.sale = r[6] || null;
            if (S.sale && S.sale.status === 'DONE') S.sale = null;
            if (S.prefs.lang) S.lang = S.prefs.lang;
            if (S.prefs.dark != null) S.dark = !!S.prefs.dark;
            if (S.prefs.cols) S.set.receiptCols = S.prefs.cols;
            if (S.prefs.copies) S.set.receiptCopies = S.prefs.copies;
            if (S.shift && S.shift.status === 'CLOSED') S.shift = null;
        });
    }
    function cats() {
        var m = {};
        S.items.forEach(function (i) { var c = (i.attrs && i.attrs.cat) || ''; if (c) m[c] = (m[c] || 0) + 1; });
        S.cats = Object.keys(m).sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); }).slice(0, 24);
    }
    function refreshCatalog(force) {
        if (S.catBusy) return Promise.resolve();
        if (!force && S.catAt && Date.now() - S.catAt < (S.set.catalogueHours || 12) * 3600000) return Promise.resolve();
        if (!S.online) { if (force) toast(t('offline'), 'warn'); return Promise.resolve(); }
        S.catBusy = true; render();
        var p = { POD: S.ctx.pod || '' };
        return FA.query('items', p).then(function (rows) {
            var items = (rows || []).map(POSE.normItem).filter(function (i) { return i.item; });
            return FA.query('customers', p).catch(function () { return []; }).then(function (cs) {
                return FA.query('discounts', p).catch(function () { return []; }).then(function (ds) {
                    var customers = (cs || []).map(function (r) { return { number: r.CUSTOMER_NUMBER || r.customer_number, name: r.CUSTOMER_NAME || r.customer_name, category: r.CATEGORY || r.category, type: r.CUSTOMER_CLASS || r.customer_class, credit: +(r.CREDIT_LIMIT || r.credit_limit || 0), vat: r.VAT || r.vat, brn: r.BRN || r.brn, phone: r.PHONE || r.phone }; }).filter(function (c) { return c.number; });
                    if (items.length || !S.items.length) { S.items = items; S.customers = customers; S.rules = ds || []; S.catAt = Date.now(); cats(); }
                    return sset('catalog', { items: S.items, customers: S.customers, rules: S.rules, at: S.catAt });
                });
            });
        }).then(function () { toast(S.items.length + ' ' + t('items') + ' · ' + S.customers.length + ' ' + t('customers'), 'ok'); })
            .catch(function (e) { toast(String(e && e.message || e), 'bad'); })
            .then(function () { S.catBusy = false; render(); });
    }

    // ── toast ─────────────────────────────────────────────────────
    function toast(msg, kind) {
        var el = document.getElementById('toast');
        if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
        el.className = 'toast ' + (kind || ''); el.textContent = msg; el.style.display = 'block';
        clearTimeout(S.toastT); S.toastT = setTimeout(function () { el.style.display = 'none'; }, kind === 'bad' ? 3500 : 1800);
    }

    // ── sale helpers ──────────────────────────────────────────────
    function ensureSale() { if (!S.sale) S.sale = POSE.newSale({ pod: S.ctx.pod, shiftId: S.shift ? S.shift.shiftId : '', device: S.ctx.device, user: S.ctx.user }); return S.sale; }
    function addItem(it, qty) {
        if (!S.shift) { toast(t('needShift'), 'warn'); return; }
        var sale = ensureSale();
        try { POSE.addItem(sale, it, qty || 1); } catch (e) { toast(e.message, 'bad'); return; }
        S.lastAdd = it.item; S.q = ''; persist(); render();
        toast(t('added') + ' ' + (qty > 1 ? qty + ' × ' : '') + it.desc, 'ok');
    }
    function addByCode(code) {
        var hit = POSE.byBarcode(S.items, code);
        if (hit && hit.item && hit.qty) { addItem(hit.item, hit.qty); return true; }
        if (hit) { addItem(hit, 1); return true; }
        var res = POSE.search(S.items, code, 3);
        if (res.length === 1) { addItem(res[0], 1); return true; }
        if (res.length > 1) { S.q = code; render(); toast(t('tooMany'), 'warn'); return false; }
        toast(t('notFound') + ' ' + code, 'bad'); return false;
    }
    function compute() { return S.sale ? POSE.compute(S.sale, ctxE()) : null; }

    // ── render ────────────────────────────────────────────────────
    function render() {
        document.body.className = S.dark ? 'dark' : '';
        var html = top() + (S.view === 'start' ? vStart() : S.view === 'sell' ? vSell() : S.view === 'customer' ? vCustomer() : S.view === 'pay' ? vPay() : S.view === 'done' ? vDone() :
            S.view === 'sales' ? vSales() : S.view === 'shift' ? vShift() : S.view === 'settings' ? vSettings() : S.view === 'parked' ? vParked() : S.view === 'return' ? vReturn() : vStart());
        html += S.sheet ? vSheet() : '';
        html += S.menu ? vMenu() : '';
        $app.innerHTML = html;
        if (S.view === 'sell' && !S.sheet && !S.cartOpen) { var q = document.getElementById('q'); if (q && document.activeElement !== q && !S.menu) { try { q.focus({ preventScroll: true }); } catch (e) { q.focus(); } } }
        var cq = document.getElementById('cq'); if (cq && document.activeElement !== cq) cq.focus();
    }
    function top() {
        var pend = 0; S.sales.forEach(function (s) { if (s.sync === 'queued') pend++; });
        var title = S.view === 'sell' ? (S.set.shop.name || t('pos')) : S.view === 'pay' ? t('pay') : S.view === 'done' ? t('receipt') : S.view === 'sales' ? t('sales') : S.view === 'shift' ? t('shift') : S.view === 'settings' ? t('settings') : S.view === 'customer' ? t('customer') : S.view === 'parked' ? t('parked') : S.view === 'return' ? t('ret') : (S.set.shop.name || t('pos'));
        var back = S.view !== 'start' && S.view !== 'sell';
        return '<div class="top">' +
            (back ? '<button class="ib" data-act="back" title="' + esc(t('back')) + '">‹</button>' : '<span class="dot' + (S.online ? '' : ' off') + '" title="' + (S.online ? t('online') : t('offline')) + '"></span>') +
            '<div class="grow"><div class="ttl">' + esc(title) + '</div><div class="sub">' + esc(S.ctx.user || '') + (S.ctx.device ? ' · ' + esc(S.ctx.device) : '') + (S.ctx.pod ? ' · ' + esc(S.ctx.pod) : '') + (pend ? ' · ' + esc(t('pending', { n: pend })) : '') + '</div></div>' +
            (S.view === 'sell' ? '<button class="ib" data-act="go" data-v="customer" title="' + esc(t('customer')) + '">' + (S.sale && S.sale.customer ? '👤' : '👥') + '</button>' : '') +
            (S.view !== 'start' ? '<button class="ib' + (S.menu ? ' on' : '') + '" data-act="menu">⋮</button>' : '') +
            '</div>';
    }
    function vMenu() {
        return '<div class="sheet-bg" data-act="menu" style="background:transparent"></div><div class="menu">' +
            '<button data-act="go" data-v="sell">🧾 ' + esc(t('pos')) + '</button>' +
            '<button data-act="go" data-v="sales">📋 ' + esc(t('sales')) + ' (' + S.sales.length + ')</button>' +
            '<button data-act="go" data-v="parked">⏸ ' + esc(t('parked')) + ' (' + S.parked.length + ')</button>' +
            '<button data-act="go" data-v="shift">💵 ' + esc(t('shift')) + '</button>' +
            '<button data-act="cat" >🔄 ' + esc(t('update')) + ' · ' + esc(t('catalog').toLowerCase()) + '</button>' +
            '<button data-act="go" data-v="settings">⚙️ ' + esc(t('settings')) + '</button>' +
            '<button data-act="lock">🔒 ' + esc(t('lock')) + '</button></div>';
    }
    function catCard() {
        var when = S.catAt ? new Date(S.catAt) : null;
        return '<div class="h2">' + esc(t('catalog')) + '</div><div class="kv"><div>' + esc(t('items')) + '</div><div class="v">' + S.items.length + '</div><div>' + esc(t('customers')) + '</div><div class="v">' + S.customers.length + '</div><div>' + esc(t('rules')) + '</div><div class="v">' + S.rules.length + '</div><div>' + esc(t('updated')) + '</div><div class="v">' + (when ? esc(when.toLocaleString()) : esc(t('never'))) + '</div></div>' +
            (!S.items.length ? '<div class="warnbox" style="margin-top:8px">' + esc(t('noCat')) + '</div>' : '') +
            '<div class="row" style="margin-top:10px"><button class="btn wide" data-act="cat" ' + (S.catBusy || !S.online ? 'disabled' : '') + '>' + (S.catBusy ? esc(t('updating')) : '🔄 ' + esc(t('update'))) + '</button></div>';
    }
    function vStart() {
        var h = '<div class="main center"><div class="card">';
        h += '<div class="h1">' + esc(S.set.shop.name || t('pos')) + '</div><div class="muted small">' + esc(S.ctx.user || '') + ' · ' + esc(S.ctx.device || '') + ' · ' + esc(S.ctx.pod || '') + ' · <span class="dot' + (S.online ? '' : ' off') + '"></span> ' + esc(S.online ? t('online') : t('offline')) + '</div>';
        if (S.shift) {
            var z = POSE.shiftSummary(S.shift, S.sales, S.set);
            h += '<div class="h2">' + esc(t('shift')) + '</div><div class="kv"><div>' + esc(t('openShift').replace(/^Open |^Ouvrir la /, '')) + '</div><div class="v">' + esc(hm(S.shift.openedAt)) + '</div><div>' + esc(t('sales')) + '</div><div class="v">' + z.sum.sales + '</div><div>' + esc(t('total')) + '</div><div class="v money">' + esc(money(z.sum.net)) + '</div></div>';
            h += '<div class="col" style="margin-top:12px"><button class="btn pri big wide" data-act="go" data-v="sell">▶ ' + esc(t('cont')) + '</button><button class="btn wide" data-act="go" data-v="shift">' + esc(t('closeShift')) + '…</button></div>';
        } else {
            h += '<div class="h2">' + esc(t('openShift')) + '</div><div class="muted small">' + esc(t('float')) + '</div>' + numpad('float', S.entry) + '<button class="btn pri big wide" style="margin-top:10px" data-act="openShift" ' + (!S.items.length ? 'disabled' : '') + '>' + esc(t('openShift')) + '</button>';
        }
        h += catCard();
        h += '<div class="row" style="margin-top:10px;justify-content:space-between"><button class="btn ghost" data-act="go" data-v="settings">⚙️ ' + esc(t('settings')) + '</button><span class="muted small">v' + esc(S.ctx.version || '') + (S.ctx.signed ? ' · ✓' : ' · draft') + '</span></div>';
        return h + '</div></div>';
    }
    function numpad(mode, entry, opts) {
        opts = opts || {};
        var h = '<div class="entry" id="entry">' + esc(entry || '0') + '</div><div class="numpad">';
        ['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', '00', '0', '.'].forEach(function (k, i) {
            h += '<button data-act="key" data-k="' + esc(k) + '" class="' + (k === '⌫' || k === 'C' ? 'k' : '') + '">' + esc(k) + '</button>';
            if (i === 13 && opts.action) h += '<button class="act" data-act="' + esc(opts.action) + '">' + esc(opts.label || 'OK') + '</button>';
        });
        return h + '</div>';
    }
    function vSell() {
        var c = compute(), lines = c ? c.lines : [], tot = c ? c.totals : null;
        var res = POSE.search(S.items.filter(function (i) { return !S.cat || (i.attrs && i.attrs.cat) === S.cat; }), S.q, 60);
        var h = '<div class="main sell"><div class="items">';
        h += '<div class="search"><input id="q" type="search" placeholder="' + esc(t('search')) + '" value="' + esc(S.q) + '" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><button class="btn" data-act="scan" title="scan">📷</button></div>';
        if (S.cats.length) {
            h += '<div class="chips"><button class="chip' + (!S.cat ? ' on' : '') + '" data-act="cat-pick" data-c="">' + esc(t('all')) + '</button>';
            S.cats.forEach(function (x) { h += '<button class="chip' + (S.cat === x ? ' on' : '') + '" data-act="cat-pick" data-c="' + esc(x) + '">' + esc(x) + '</button>'; });
            h += '</div>';
        }
        h += '<div class="grid" id="grid">' + grid(res) + '</div></div>';
        // cart
        var n = lines.length;
        h += '<div class="cartbar"><div><div class="tot money">' + esc(tot ? money(tot.rounded) : money(0)) + '</div><div class="muted small">' + n + ' ' + esc(t('items').toLowerCase()) + (S.sale && S.sale.customer ? ' · ' + esc(S.sale.customer.name) : '') + '</div></div><div class="sp"></div>' +
            '<button class="btn" data-act="cart">' + esc(t('cart')) + ' ▲</button><button class="btn pri" data-act="go" data-v="pay" ' + (n ? '' : 'disabled') + '>' + esc(t('pay')) + '</button></div>';
        h += '<div class="cart' + (S.cartOpen ? ' open' : '') + '"><div class="head"><span>' + esc(t('cart')) + ' · ' + n + '</span><span class="sp"></span>' +
            (S.sale && S.sale.customer ? '<button class="btn" style="min-height:36px" data-act="go" data-v="customer">👤 ' + esc(S.sale.customer.name) + '</button>' : '<button class="btn ghost" style="min-height:36px" data-act="go" data-v="customer">' + esc(t('walkin')) + '</button>') +
            '<button class="btn ghost close" style="min-height:36px" data-act="cart">✕</button></div><div class="lines">';
        if (!n) h += '<div class="empty">' + esc(t('empty')) + '</div>';
        lines.forEach(function (x) {
            var l = x.line, cc = x.calc;
            h += '<div class="line" data-act="line" data-id="' + esc(l.id) + '"><div><div class="d' + (cc.sign < 0 ? ' ret' : '') + '">' + esc(l.desc || l.item) + '</div><div class="m">' + esc(l.item) + ' · ' + esc(money(Math.abs(cc.sell))) + (cc.pct ? ' · −' + esc(String(POSE.roundCash(cc.pct, 0))) + '%' : '') + (cc.consTotal ? ' · ' + esc(t('deposits').toLowerCase()) : '') + (cc.crtTotal ? ' · ' + Math.abs(cc.crtQty) + ' ' + esc(t('crates').toLowerCase()) : '') + '</div>' +
                '<div class="qty" data-stop="1"><button data-act="qty" data-id="' + esc(l.id) + '" data-d="-1">−</button><span>' + esc(String(Math.abs(l.qty))) + '</span><button data-act="qty" data-id="' + esc(l.id) + '" data-d="1">+</button></div></div>' +
                '<div class="t money' + (cc.sign < 0 ? ' ret' : '') + '">' + esc(money(cc.net)) + '</div></div>';
        });
        h += '</div>';
        if (tot) {
            h += '<div class="totals"><div class="r"><span>' + esc(t('subtotal')) + '</span><span class="money">' + esc(money(tot.gross)) + '</span></div>' +
                (tot.disc ? '<div class="r"><span>' + esc(t('discount')) + '</span><span class="money">−' + esc(money(Math.abs(tot.disc))) + '</span></div>' : '') +
                (tot.tax ? '<div class="r"><span>' + esc(t('vat')) + '</span><span class="money">' + esc(money(tot.tax)) + '</span></div>' : '') +
                (tot.cons ? '<div class="r"><span>' + esc(t('deposits')) + '</span><span class="money">' + esc(money(tot.cons)) + '</span></div>' : '') +
                (tot.crates ? '<div class="r"><span>' + esc(t('crates')) + '</span><span class="money">' + esc(money(tot.crates)) + '</span></div>' : '') +
                (tot.rounding ? '<div class="r"><span>' + esc(t('rounding')) + '</span><span class="money">' + esc(money(tot.rounding)) + '</span></div>' : '') +
                '<div class="r big"><span>' + esc(t('total')) + '</span><span class="money">' + esc(money(tot.rounded)) + '</span></div></div>';
        }
        h += '<div class="foot"><button class="btn" data-act="clearSale" ' + (n ? '' : 'disabled') + '>' + esc(t('clear')) + '</button><button class="btn" data-act="parkSale" ' + (n ? '' : 'disabled') + '>' + esc(t('park')) + '</button><span class="sp"></span><button class="btn pri big" data-act="go" data-v="pay" ' + (n ? '' : 'disabled') + '>' + esc(t('pay')) + ' ›</button></div></div></div>';
        return h;
    }
    function grid(res) {
        if (!S.items.length) return '<div class="empty">' + esc(t('noCat')) + '</div>';
        if (!res.length) return '<div class="empty">' + esc(t('notFound')) + ' "' + esc(S.q) + '"</div>';
        return res.map(function (it) {
            return '<button class="prod' + (S.lastAdd === it.item ? ' inc' : '') + '" data-act="add" data-i="' + esc(it.item) + '"><div class="d">' + esc(it.desc || it.item) + '</div><div><div class="p money">' + esc(money(it.price)) + '</div><div class="c">' + esc(it.item) + (it.uom ? ' · ' + esc(it.uom) : '') + '</div></div></button>';
        }).join('');
    }
    function vCustomer() {
        var q = S.custQ.trim().toUpperCase();
        var list = S.customers.filter(function (c) { return !q || (String(c.name || '').toUpperCase().indexOf(q) >= 0 || String(c.number || '').toUpperCase().indexOf(q) >= 0 || String(c.phone || '').indexOf(q) >= 0); }).slice(0, 60);
        var h = '<div class="main page"><div class="search"><input id="cq" type="search" placeholder="' + esc(t('customer')) + '…" value="' + esc(S.custQ) + '" autocomplete="off"></div><div class="body" style="padding-top:0">';
        h += '<div class="item" data-act="cust" data-n=""><div><div class="d">' + esc(t('walkin')) + '</div><div class="m">' + esc(t('noCustomer')) + '</div></div><div class="t">' + (S.sale && !S.sale.customer ? '✓' : '') + '</div></div>';
        list.forEach(function (c) { h += '<div class="item" data-act="cust" data-n="' + esc(c.number) + '"><div><div class="d">' + esc(c.name) + '</div><div class="m">' + esc(c.number) + (c.category ? ' · ' + esc(c.category) : '') + (c.credit ? ' · ' + esc(t('creditLimit')) + ' ' + esc(money(c.credit)) : '') + '</div></div><div class="t">' + (S.sale && S.sale.customer && S.sale.customer.number === c.number ? '✓' : '') + '</div></div>'; });
        if (!list.length) h += '<div class="empty">' + esc(t('notFound')) + ' "' + esc(S.custQ) + '"</div>';
        return h + '</div></div>';
    }
    function vPay() {
        if (!S.sale) return vSell();
        var b = POSE.balance(S.sale, ctxE()), refund = b.total < 0, p = S.pay || (S.pay = { tender: 'CASH' });
        var h = '<div class="main pay"><div class="due"><div class="muted small">' + esc(refund ? t('refund') : t('due')) + (S.sale.customer ? ' · ' + esc(S.sale.customer.name) : '') + '</div><div class="big money">' + esc(money(Math.abs(b.due || (refund ? b.total - b.paid : 0)))) + '</div>' +
            '<div class="muted small">' + esc(t('total')) + ' ' + esc(money(Math.abs(b.total))) + ' · ' + esc(t('paid')) + ' ' + esc(money(Math.abs(b.paid))) + '</div></div><div class="body">';
        h += '<div class="tenders">' + tenders().filter(function (x) { return !refund || x.code !== 'CREDIT' || S.sale.customer; }).map(function (x) { return '<button class="' + (p.tender === x.code ? 'on' : '') + '" data-act="tender" data-t="' + x.code + '">' + esc(tenderLabel(x.code)) + '</button>'; }).join('') + '</div>';
        var remaining = refund ? Math.abs(POSE.roundCash(b.total - b.paid, 0)) : b.due;
        h += numpad('pay', S.entry, { action: 'addPay', label: t('addPay') });
        h += '<div class="quick"><button data-act="quick" data-a="' + remaining + '">' + esc(t('exact')) + ' ' + esc(money(remaining)) + '</button>' + (p.tender === 'CASH' && !refund ? (S.set.quickCash || []).filter(function (a) { return a >= remaining; }).slice(0, 4).map(function (a) { return '<button data-act="quick" data-a="' + a + '">' + esc(money(a)) + '</button>'; }).join('') : '') + '</div>';
        if (p.tender !== 'CASH') h += '<div class="field" style="margin-top:8px"><label>' + esc(t('ref')) + '</label><input id="payref" value="' + esc(p.ref || '') + '" placeholder="' + esc((POSE.tender(p.tender) || {}).ref || '') + '"></div>';
        if (S.sale.payments.length) {
            h += '<div class="paylist" style="margin-top:10px">' + S.sale.payments.map(function (x) { return '<div class="r"><span>' + esc(tenderLabel(x.tender)) + (x.ref ? ' · ' + esc(x.ref) : '') + '</span><span class="row"><span class="money">' + esc(money(x.amount)) + '</span><button class="x" data-act="rmPay" data-id="' + esc(x.id) + '">✕</button></span></div>'; }).join('') + '</div>';
        }
        if (b.change > 0) h += '<div class="change">' + esc(t('change')) + ' ' + esc(money(b.change)) + '</div>';
        var can = POSE.canComplete(S.sale, ctxE());
        h += '<button class="btn ok big wide" style="margin-top:12px" data-act="complete" ' + (can.ok ? '' : 'disabled') + '>' + esc(refund ? t('completeRet') : t('complete')) + '</button>';
        if (!can.ok && S.sale.payments.length) h += '<div class="muted small" style="text-align:center;margin-top:6px">' + esc(can.why) + '</div>';
        return h + '</div></div>';
    }
    function vDone() {
        var s = S.detail; if (!s) return vSell();
        var r = POSE.receipt(s, S.set);
        var st = s.sync === 'sent' ? '<span class="pill ok">' + esc(t('sent')) + '</span>' : s.sync === 'queued' ? '<span class="pill warn">' + esc(t('queued')) + '</span>' : s.sync === 'failed' ? '<span class="pill bad">' + esc(t('failed')) + '</span>' : '<span class="pill">…</span>';
        var h = '<div class="main page"><div class="body">';
        h += '<div class="row"><div><b>' + esc(s.number) + '</b> · ' + esc(hm(s.doneAt)) + ' ' + st + '</div><span class="sp"></span><div class="money" style="font-weight:800;font-size:18px">' + esc(money(s.totals.rounded)) + '</div></div>';
        if (s.totals.change) h += '<div class="change">' + esc(t('change')) + ' ' + esc(money(s.totals.change)) + '</div>';
        h += '<div class="receipt">' + r.html + '</div>';
        h += '<div class="row"><button class="btn big" style="flex:1" data-act="print" data-id="' + esc(s.saleId) + '">🖨 ' + esc(t('print')) + '</button>' + (S.view === 'done' ? '<button class="btn pri big" style="flex:1" data-act="newSale">' + esc(t('newSale')) + ' ›</button>' : (s.kind === 'SALE' && s.status === 'DONE' && S.set.allowReturns ? '<button class="btn big" style="flex:1" data-act="retStart" data-id="' + esc(s.saleId) + '">↩ ' + esc(t('ret')) + '</button>' : '')) + '</div>';
        return h + '</div></div>';
    }
    function vSales() {
        if (S.detail) return vDone();
        var list = S.sales.slice().sort(function (a, b) { return a.doneAt < b.doneAt ? 1 : -1; });
        var h = '<div class="main page"><div class="body" style="padding:0">';
        if (!list.length) h += '<div class="empty">' + esc(t('noSales')) + '</div>';
        list.forEach(function (s) { h += '<div class="item" data-act="detail" data-id="' + esc(s.saleId) + '"><div><div class="d">' + esc(s.number) + (s.kind === 'RETURN' ? ' · ' + esc(t('ret')) : '') + (s.customer ? ' · ' + esc(s.customer.name) : '') + '</div><div class="m">' + esc(hm(s.doneAt)) + ' · ' + (s.lines || []).length + ' ' + esc(t('items').toLowerCase()) + ' · ' + (s.payments || []).filter(function (p) { return p.ref !== 'change'; }).map(function (p) { return tenderLabel(p.tender); }).join(', ') + ' · ' + esc(s.sync === 'sent' ? t('sent') : s.sync === 'queued' ? t('queued') : s.sync === 'failed' ? t('failed') : '…') + '</div></div><div class="t money' + (s.kind === 'RETURN' ? ' ret' : '') + '">' + esc(money(s.totals.rounded)) + '</div></div>'; });
        return h + '</div></div>';
    }
    function vReturn() {
        var r = S.ret; if (!r) return vSales();
        var h = '<div class="main page"><div class="body">';
        h += '<div class="muted">' + esc(t('retPick')) + ' · ' + esc(r.of.number) + '</div><div class="card" style="padding:0">';
        var total = 0;
        r.of.lines.forEach(function (l) {
            if (l.type === 'RET') return;
            var q = r.picks[l.id] || 0, sell = l.calc ? Math.abs(l.calc.sell) : l.price;
            total += q * sell;
            h += '<div class="line"><div><div class="d">' + esc(l.desc || l.item) + '</div><div class="m">' + esc(String(Math.abs(l.qty))) + ' ' + esc(t('sold')) + ' · ' + esc(money(sell)) + '</div><div class="qty"><button data-act="retQty" data-id="' + esc(l.id) + '" data-d="-1">−</button><span>' + q + '</span><button data-act="retQty" data-id="' + esc(l.id) + '" data-d="1">+</button></div></div><div class="t money">' + esc(money(q * sell)) + '</div></div>';
        });
        h += '</div><div class="field"><label>' + esc(t('reason')) + '</label><input id="retReason" value="' + esc(r.reason || '') + '"></div>';
        h += '<button class="btn bad big wide" data-act="retGo" ' + (total > 0 ? '' : 'disabled') + '>' + esc(t('retQty', { n: money(total) })) + ' ›</button>';
        return h + '</div></div>';
    }
    function vShift() {
        var h = '<div class="main page"><div class="body">';
        if (!S.shift) { h += '<div class="empty">' + esc(t('needShift')) + '</div>'; return h + '</div></div>'; }
        var z = POSE.shiftSummary(S.shift, S.sales, S.set);
        h += '<div class="card"><div class="h2" style="margin-top:0">' + esc(t('xreport')) + ' · ' + esc(hm(S.shift.openedAt)) + '</div><div class="stat">' +
            '<div class="s"><div class="l">' + esc(t('sales')) + '</div><div class="v">' + z.sum.sales + '</div></div><div class="s"><div class="l">' + esc(t('ret')) + '</div><div class="v">' + z.sum.returns + '</div></div>' +
            '<div class="s"><div class="l">' + esc(t('total')) + '</div><div class="v money">' + esc(money(z.sum.net)) + '</div></div><div class="s"><div class="l">' + esc(t('vat')) + '</div><div class="v money">' + esc(money(z.sum.tax)) + '</div></div></div>';
        h += '<div class="kv" style="margin-top:12px">' + Object.keys(z.byTender).map(function (k) { return '<div>' + esc(tenderLabel(k)) + '</div><div class="v money">' + esc(money(z.byTender[k])) + '</div>'; }).join('') +
            '<div>' + esc(t('float')) + '</div><div class="v money">' + esc(money(z.floatAmt)) + '</div><div>' + esc(t('payout')) + '</div><div class="v money">−' + esc(money(z.payouts)) + '</div><div><b>' + esc(t('expected')) + '</b></div><div class="v money"><b>' + esc(money(z.cashExpected)) + '</b></div></div></div>';
        if ((S.shift.payouts || []).length) h += '<div class="card"><div class="h2" style="margin-top:0">' + esc(t('payout')) + '</div>' + S.shift.payouts.map(function (p) { return '<div class="row"><span>' + esc(hm(p.at)) + ' · ' + esc(p.reason || '') + '</span><span class="sp"></span><span class="money">' + esc(money(p.amount)) + '</span></div>'; }).join('') + '</div>';
        h += '<div class="row"><button class="btn big" style="flex:1" data-act="sheet" data-s="payout">💸 ' + esc(t('payout')) + '</button><button class="btn pri big" style="flex:1" data-act="sheet" data-s="close">' + esc(t('closeShift')) + ' ›</button></div>';
        return h + '</div></div>';
    }
    function vParked() {
        var h = '<div class="main page"><div class="body" style="padding:0">';
        if (!S.parked.length) h += '<div class="empty">' + esc(t('noParked')) + '</div>';
        S.parked.forEach(function (s) { var c = POSE.compute(s, ctxE()); h += '<div class="item"><div><div class="d">' + esc(hm(s.openedAt)) + (s.customer ? ' · ' + esc(s.customer.name) : '') + '</div><div class="m">' + s.lines.length + ' ' + esc(t('items').toLowerCase()) + ' · ' + esc(money(c.totals.rounded)) + '</div></div><div class="row"><button class="btn" data-act="unpark" data-id="' + esc(s.saleId) + '">' + esc(t('resume')) + '</button><button class="btn ghost" data-act="delPark" data-id="' + esc(s.saleId) + '">✕</button></div></div>'; });
        return h + '</div></div>';
    }
    function vSettings() {
        var h = '<div class="main page"><div class="body">';
        h += '<div class="card"><div class="field"><label>' + esc(t('language')) + '</label><div class="tog"><button class="' + (S.lang === 'en' ? 'on' : '') + '" data-act="lang" data-l="en">English</button><button class="' + (S.lang === 'fr' ? 'on' : '') + '" data-act="lang" data-l="fr">Français</button></div></div>' +
            '<div class="field" style="margin-top:10px"><label>' + esc(t('dark')) + '</label><div class="tog"><button class="' + (!S.dark ? 'on' : '') + '" data-act="dark" data-d="0">☀️</button><button class="' + (S.dark ? 'on' : '') + '" data-act="dark" data-d="1">🌙</button></div></div>' +
            '<div class="field" style="margin-top:10px"><label>' + esc(t('cols')) + '</label><div class="tog">' + [32, 42, 48].map(function (c) { return '<button class="' + (S.set.receiptCols === c ? 'on' : '') + '" data-act="cols" data-c="' + c + '">' + c + '</button>'; }).join('') + '</div></div>' +
            '<div class="field" style="margin-top:10px"><label>' + esc(t('copies')) + '</label><div class="tog">' + [1, 2, 3].map(function (c) { return '<button class="' + ((S.set.receiptCopies || 1) === c ? 'on' : '') + '" data-act="copies" data-c="' + c + '">' + c + '</button>'; }).join('') + '</div></div>' +
            '<div class="row" style="margin-top:12px"><button class="btn" style="flex:1" data-act="testPrint">🖨 ' + esc(t('testPrint')) + '</button></div></div>';
        h += '<div class="card">' + catCard() + '<button class="btn ghost wide" style="margin-top:8px" data-act="clearCat">' + esc(t('clearCat')) + '</button></div>';
        h += '<div class="card"><div class="h2" style="margin-top:0">' + esc(t('about')) + '</div><div class="kv"><div>App</div><div class="v">' + esc(S.ctx.name || 'POS') + ' v' + esc(S.ctx.version || '') + '</div><div>Engine</div><div class="v">' + esc(POSE.VERSION) + '</div><div>Shell</div><div class="v">' + esc(S.ctx.shell || '') + '</div><div>Signed</div><div class="v">' + (S.ctx.signed ? '✓' : 'draft') + '</div><div>User</div><div class="v">' + esc(S.ctx.user || '') + '</div><div>Device</div><div class="v">' + esc(S.ctx.device || '') + '</div><div>Pod</div><div class="v">' + esc(S.ctx.pod || '') + '</div></div></div>';
        return h + '</div></div>';
    }
    function vSheet() {
        var s = S.sheet, h = '<div class="sheet-bg" data-act="sheetClose"><div class="sheet" data-stop="1">';
        if (s.kind === 'line') {
            var l = POSE.line(S.sale, s.id); if (!l) return '';
            h += '<div class="h2">' + esc(l.desc || l.item) + '</div><div class="muted small">' + esc(l.item) + ' · ' + esc(money(l.price)) + (l.uom ? ' / ' + esc(l.uom) : '') + '</div>';
            h += '<div class="muted small" style="margin-top:8px">' + esc(t('qty')) + '</div>' + numpad('qty', S.entry, { action: 'setQty', label: t('done') });
            h += '<div class="muted small" style="margin-top:10px">' + esc(t('disc')) + ' · ' + esc(String(l.discAdd || 0)) + '%</div><div class="quick">' + [0, 5, 10, 15, S.set.maxDiscountPct].filter(function (v, i, a) { return a.indexOf(v) === i && v <= S.set.maxDiscountPct; }).map(function (v) { return '<button data-act="disc" data-v="' + v + '" ' + (l.discAdd === v ? 'style="background:var(--pri);color:#fff"' : '') + '>' + v + '%</button>'; }).join('') + '</div>';
            h += '<div class="field" style="margin-top:10px"><label>' + esc(t('note')) + '</label><input id="lineNote" value="' + esc(l.note || '') + '"></div>';
            h += '<div class="row" style="margin-top:12px"><button class="btn bad" data-act="rmLine">' + esc(t('remove')) + '</button><span class="sp"></span><button class="btn pri" data-act="setQty">' + esc(t('done')) + '</button></div>';
        } else if (s.kind === 'payout') {
            h += '<div class="h2">' + esc(t('payout')) + '</div>' + numpad('payout', S.entry) + '<div class="field" style="margin-top:10px"><label>' + esc(t('reason')) + '</label><input id="poReason"></div><div class="row" style="margin-top:12px"><button class="btn" data-act="sheetClose">' + esc(t('cancel')) + '</button><span class="sp"></span><button class="btn pri" data-act="payoutGo">' + esc(t('done')) + '</button></div>';
        } else if (s.kind === 'close') {
            var z = POSE.shiftSummary(S.shift, S.sales, S.set), counted = num(S.entry), diff = POSE.roundCash(counted - z.cashExpected, 0);
            h += '<div class="h2">' + esc(t('closeShift')) + '</div><div class="muted small">' + esc(t('counted')) + '</div>' + numpad('close', S.entry) +
                '<div class="kv" style="margin-top:10px"><div>' + esc(t('expected')) + '</div><div class="v money">' + esc(money(z.cashExpected)) + '</div><div>' + esc(t('variance')) + '</div><div class="v money" style="color:' + (Math.abs(diff) < 0.005 ? 'var(--ok)' : 'var(--bad)') + '">' + esc(money(diff)) + '</div></div>' +
                '<div class="row" style="margin-top:12px"><button class="btn" data-act="sheetClose">' + esc(t('cancel')) + '</button><span class="sp"></span><button class="btn bad" data-act="closeGo">' + esc(t('confirmClose')) + '</button></div>';
        }
        return h + '</div></div>';
    }

    // ── actions ───────────────────────────────────────────────────
    function go(v) { S.menu = false; S.sheet = null; S.cartOpen = false; S.entry = ''; if (v === 'pay') { if (!S.sale || !S.sale.lines.length) return; S.pay = { tender: 'CASH' }; } if (v === 'sales') S.detail = null; if (v === 'customer') S.custQ = ''; S.view = v; render(); }
    function key(k) {
        var e = S.entry || '';
        if (k === 'C') e = ''; else if (k === '⌫') e = e.slice(0, -1); else if (k === '.') { if (e.indexOf('.') < 0) e = (e || '0') + '.'; } else { if (e.indexOf('.') >= 0 && e.length - e.indexOf('.') > 2) return; e = (e === '0' ? '' : e) + k; if (e.length > 10) return; }
        S.entry = e; var el = document.getElementById('entry'); if (el) el.textContent = e || '0'; else render();
        if (S.sheet && S.sheet.kind === 'close') render();
    }
    function finishSale() {
        var sale = S.sale, ctx = ctxE();
        var done;
        try { done = POSE.complete(sale, ctx); } catch (e) { toast(e.message, 'bad'); return; }
        S.seq++;
        done.sync = 'sending';
        S.sales.push(done); S.sale = null; S.detail = done; S.view = 'done'; S.pay = null; S.entry = '';
        persist().then(render);
        var doc = POSE.saleDoc(done);
        FA.submit('pos_sale', doc, { subId: done.saleId, ref: done.number, amount: done.totals.rounded }).then(function (r) { done.sync = r && r.queued ? 'queued' : 'sent'; }, function (e) { done.sync = 'failed'; done.syncError = e.message; toast(e.message, 'bad'); }).then(function () { persist(); render(); });
        if (S.set.autoPrint) printSale(done);
    }
    function printSale(s) {
        var r = POSE.receipt(s, S.set);
        return FA.print({ text: r.text, html: r.html, copies: S.set.receiptCopies || 1, cols: r.cols, title: s.number }).then(function () { toast(t('print') + ' ✓', 'ok'); }, function (e) { toast(e.message, 'bad'); });
    }
    function submitShift(sh) { return FA.submit('pos_shift', POSE.shiftDoc(sh), { subId: sh.shiftId, ref: sh.shiftId, amount: sh.counted }).catch(function (e) { toast(e.message, 'bad'); }); }
    var ACT = {
        back: function () { if (S.view === 'pay') { S.pay = null; go('sell'); } else if (S.view === 'done') { go('sell'); } else if (S.view === 'return') go('sales'); else if (S.sales && S.detail && S.view === 'sales') { S.detail = null; render(); } else go(S.shift ? 'sell' : 'start'); },
        go: function (d) { go(d.v); },
        menu: function () { S.menu = !S.menu; render(); },
        lock: function () { S.menu = false; S.view = 'start'; S.entry = ''; render(); },
        key: function (d) { key(d.k); },
        openShift: function () { S.shift = POSE.openShift({ pod: S.ctx.pod, device: S.ctx.device, user: S.ctx.user, floatAmt: num(S.entry) }); S.entry = ''; persist(); submitShift(S.shift); go('sell'); },
        cat: function () { S.menu = false; refreshCatalog(true); },
        'cat-pick': function (d) { S.cat = d.c || ''; render(); },
        add: function (d) { var it = S.items.filter(function (i) { return i.item === d.i; })[0]; if (it) addItem(it, 1); },
        scan: function () { FA.scan({}).then(function (r) { if (r && r.code) addByCode(r.code); }, function (e) { toast(e.message, 'warn'); }); },
        cart: function () { S.cartOpen = !S.cartOpen; render(); },
        line: function (d) { S.sheet = { kind: 'line', id: d.id }; S.entry = String(Math.abs(POSE.line(S.sale, d.id).qty)); render(); },
        qty: function (d) { var l = POSE.line(S.sale, d.id); if (!l) return; POSE.setQty(S.sale, d.id, Math.abs(l.qty) + (+d.d)); persist(); render(); },
        setQty: function () { var s = S.sheet; if (!s) return; var l = POSE.line(S.sale, s.id); if (l) { var n = document.getElementById('lineNote'); if (n) l.note = n.value; POSE.setQty(S.sale, s.id, num(S.entry)); } S.sheet = null; S.entry = ''; persist(); render(); },
        disc: function (d) { var s = S.sheet; if (!s) return; try { POSE.setDiscount(S.sale, s.id, +d.v, S.set); } catch (e) { toast(e.message, 'bad'); } persist(); render(); },
        rmLine: function () { var s = S.sheet; if (s) POSE.removeLine(S.sale, s.id); S.sheet = null; persist(); render(); },
        clearSale: function () { if (!S.sale || !S.sale.lines.length || confirm(t('voidQ'))) { S.sale = null; persist(); render(); } },
        parkSale: function () { if (!S.sale || !S.sale.lines.length) return; POSE.park(S.sale); S.parked.push(S.sale); S.sale = null; persist(); render(); toast(t('park') + ' ✓', 'ok'); },
        unpark: function (d) { var s = S.parked.filter(function (x) { return x.saleId === d.id; })[0]; if (!s) return; if (S.sale && S.sale.lines.length) { POSE.park(S.sale); S.parked.push(S.sale); } S.parked = S.parked.filter(function (x) { return x.saleId !== d.id; }); POSE.resume(s); S.sale = s; persist(); go('sell'); },
        delPark: function (d) { S.parked = S.parked.filter(function (x) { return x.saleId !== d.id; }); persist(); render(); },
        cust: function (d) { if (!S.sale) ensureSale(); var c = S.customers.filter(function (x) { return x.number === d.n; })[0]; POSE.setCustomer(S.sale, c || null); persist(); go('sell'); },
        tender: function (d) { S.pay.tender = d.t; S.entry = ''; render(); },
        quick: function (d) { S.entry = String(d.a); ACT.addPay(); },
        addPay: function () {
            var b = POSE.balance(S.sale, ctxE()), refund = b.total < 0, amt = num(S.entry);
            if (!amt) { amt = refund ? Math.abs(POSE.roundCash(b.total - b.paid, 0)) : b.due; }
            var ref = document.getElementById('payref'); ref = ref ? ref.value : '';
            try { POSE.addPayment(S.sale, { tender: S.pay.tender, amount: refund ? -amt : amt, ref: ref }, ctxE()); } catch (e) { toast(e.message, 'bad'); return; }
            S.entry = ''; S.pay.ref = ''; persist(); render();
        },
        rmPay: function (d) { POSE.removePayment(S.sale, d.id); persist(); render(); },
        complete: function () { finishSale(); },
        newSale: function () { S.detail = null; go('sell'); },
        print: function (d) { var s = S.sales.filter(function (x) { return x.saleId === d.id; })[0] || S.detail; if (s) printSale(s); },
        testPrint: function () { var s = POSE.newSale({ pod: S.ctx.pod, device: S.ctx.device, user: S.ctx.user }); if (S.items[0]) { POSE.addItem(s, S.items[0], 1); } s.number = 'TEST'; s.status = 'DONE'; s.doneAt = POSE.nowIso(); s.totals = POSE.compute(s, ctxE()).totals; printSale(s); },
        detail: function (d) { S.detail = S.sales.filter(function (x) { return x.saleId === d.id; })[0] || null; render(); },
        retStart: function (d) { var s = S.sales.filter(function (x) { return x.saleId === d.id; })[0]; if (!s) return; S.ret = { of: s, picks: {}, reason: '' }; S.view = 'return'; render(); },
        retQty: function (d) { var r = S.ret, l = POSE.line(r.of, d.id); if (!l) return; var q = (r.picks[d.id] || 0) + (+d.d); r.picks[d.id] = Math.max(0, Math.min(Math.abs(l.qty), q)); render(); },
        retGo: function () {
            var r = S.ret, reason = document.getElementById('retReason'); reason = reason ? reason.value : '';
            var picks = Object.keys(r.picks).filter(function (id) { return r.picks[id] > 0; }).map(function (id) { return { lineId: id, qty: r.picks[id], reason: reason }; });
            if (!picks.length) return;
            if (S.sale && S.sale.lines.length) { POSE.park(S.sale); S.parked.push(S.sale); }
            S.sale = POSE.returnOf(r.of, picks, { pod: S.ctx.pod, shiftId: S.shift ? S.shift.shiftId : '', device: S.ctx.device, user: S.ctx.user });
            S.sale.note = reason; S.ret = null; S.detail = null; persist(); go('pay');
        },
        sheet: function (d) { S.sheet = { kind: d.s }; S.entry = ''; render(); },
        sheetClose: function () { S.sheet = null; S.entry = ''; render(); },
        payoutGo: function () { var a = num(S.entry), r = document.getElementById('poReason'); if (!a) return; POSE.payout(S.shift, a, r ? r.value : '', S.ctx.user); S.sheet = null; S.entry = ''; persist(); submitShift(S.shift); render(); },
        closeGo: function () {
            if (!confirm(t('closeQ'))) return;
            POSE.closeShift(S.shift, num(S.entry), S.sales, S.set);
            var sh = S.shift; S.shift = null; S.sheet = null; S.entry = ''; S.sale = null;
            persist().then(function () { return submitShift(sh); }).then(function () { toast(t('closeShift') + ' ✓', 'ok'); go('start'); });
        },
        lang: function (d) { S.lang = d.l; S.prefs.lang = d.l; persist(); render(); },
        dark: function (d) { S.dark = d.d === '1'; S.prefs.dark = S.dark; persist(); render(); },
        cols: function (d) { S.set.receiptCols = +d.c; S.prefs.cols = +d.c; persist(); render(); },
        copies: function (d) { S.set.receiptCopies = +d.c; S.prefs.copies = +d.c; persist(); render(); },
        clearCat: function () { S.items = []; S.customers = []; S.rules = []; S.catAt = 0; S.cats = []; sset('catalog', null); render(); }
    };
    $app.addEventListener('click', function (ev) {
        var el = ev.target.closest('[data-act]'); if (!el) return;
        var stop = ev.target.closest('[data-stop]'); if (stop && stop !== el && !el.contains(stop) && el.contains(ev.target) && el.getAttribute('data-act') === 'line') return;
        if (el.getAttribute('data-act') === 'sheetClose' && ev.target !== el) return;
        if (el.getAttribute('data-act') === 'menu' && ev.target !== el && el.className.indexOf('sheet-bg') >= 0) return;
        ev.preventDefault();
        var fn = ACT[el.getAttribute('data-act')]; if (fn) fn(el.dataset, el, ev);
    });
    $app.addEventListener('input', function (ev) {
        if (ev.target.id === 'q') { S.q = ev.target.value; var g = document.getElementById('grid'); if (g) g.innerHTML = grid(POSE.search(S.items.filter(function (i) { return !S.cat || (i.attrs && i.attrs.cat) === S.cat; }), S.q, 60)); }
        if (ev.target.id === 'cq') { S.custQ = ev.target.value; var b = $app.querySelector('.page .body'); if (b) { var tmp = document.createElement('div'); tmp.innerHTML = vCustomer(); b.innerHTML = tmp.querySelector('.body').innerHTML; } }
        if (ev.target.id === 'payref' && S.pay) S.pay.ref = ev.target.value;
    });
    $app.addEventListener('keydown', function (ev) {
        if (ev.target.id === 'q' && ev.key === 'Enter') { ev.preventDefault(); var v = ev.target.value.trim(); if (!v) return; if (addByCode(v)) { ev.target.value = ''; S.q = ''; } }
        if (ev.key === 'Escape') { if (S.sheet) ACT.sheetClose(); else if (S.menu) { S.menu = false; render(); } }
    });

    // ── boot ──────────────────────────────────────────────────────
    FA.ready(function (ctx) {
        S.ctx = ctx; S.set = POSE.settings(ctx.settings); S.online = ctx.online !== false;
        S.lang = (ctx.settings && ctx.settings.language) || 'en';
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) S.dark = true;
        load().then(function () {
            S.loading = false;
            if (S.shift && (S.sale || S.items.length)) S.view = 'sell';
            render();
            refreshCatalog(false);
        }).catch(function (e) { toast(String(e && e.message || e), 'bad'); render(); });
    });
    FA.on('ctx', function (c) { S.ctx = c; S.online = c.online !== false; var d = $app.querySelector('.top .dot'); if (d) d.className = 'dot' + (S.online ? '' : ' off'); });
    FA.on('barcode', function (d) { if (d && d.code && S.view === 'sell') addByCode(String(d.code)); });
    FA.on('back', function () { ACT.back(); });
})();

/* Fusion Order Management — editor extras: sales credits (§3.3.10), notes & attachments (§3.3.11), customer credit check
   (§3.3.13), order validations (§3.3.16), reservations hub (§3.3.21) and branch sales → branch purchase order (§3.3.22/24).
   Deletes (sales credit, note, attachment, reservation, charge) need HTTP DELETE, which the app's Fusion relay does not
   allow — those buttons explain it instead of failing. */

FOM.NO_DELETE = 'Deleting needs HTTP DELETE, which the app\'s Fusion relay does not allow — remove it in Fusion.';

// ── sales credits ──────────────────────────────────────────────
FOM.edLoadCredits = function (E) {
    if (!E.orderKey) return Promise.resolve();
    return FOM.get(E.orderPath() + '/child/salesCredits', { limit: 100, onlyData: false }).then(function (j) { E.salesCredits = j.items || []; E.drawHeader(); if (E.ltabs) E.ltabs.reload('credits'); }).catch(function () { });
};
FOM.edCreditsTab = function (E, p) {
    if (!E.orderKey) { p.innerHTML = '<div class="empty"><i class="fa-solid fa-user-tie"></i>Save the order first.</div>'; return; }
    var rows = E.salesCredits, tot = FOM.sum(rows, 'Percent');
    p.innerHTML = '<div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px"><div class="row-btns"><span class="chip ' + (Math.abs(tot - 100) < 0.001 ? 'ok' : 'warn') + '">Total ' + FOM.r2(tot) + '%</span>' + (rows.length && Math.abs(tot - 100) >= 0.001 ? '<span class="muted" style="color:var(--warn);font-size:.76rem">Quota credits should total 100%</span>' : '') + '<span class="grow"></span><button class="btn sm primary" data-add><i class="fa-solid fa-plus"></i> Add sales credit</button><button class="btn sm" data-rl><i class="fa-solid fa-rotate"></i></button></div>' +
        FOM.table(rows, [{ label: 'Salesperson', html: function (c) { return esc(c.Salesperson || c.SalespersonName || ('#' + (c.SalespersonId || ''))); } }, { label: 'Type', html: function (c) { return esc(c.SalesCreditType || (String(c.SalesCreditTypeId) === '1' ? 'Quota Sales Credit' : c.SalesCreditTypeId || '')); } }, { f: 'Percent', label: 'Percent', n: 1 }, { label: '', html: function (c, i) { return '<button class="btn sm icon" data-ed="' + i + '" title="Edit"><i class="fa-solid fa-pen"></i></button> <button class="btn sm icon" disabled title="' + esc(FOM.NO_DELETE) + '"><i class="fa-solid fa-trash"></i></button>'; } }], { empty: 'No sales credits on this order.' }) + '</div>';
    p.querySelector('[data-rl]').onclick = function () { FOM.edLoadCredits(E); };
    p.querySelector('[data-add]').onclick = function () { FOM.creditDlg(E, null); };
    p.onclick = function (e) { var b = e.target.closest('[data-ed]'); if (b) FOM.creditDlg(E, rows[+b.getAttribute('data-ed')]); };
};
FOM.creditDlg = function (E, row) {
    FOM.dlg({
        title: row ? 'Edit sales credit' : 'Add sales credit',
        body: '<div class="form"><label>Salesperson<input data-n list="fom-cr-reps" value="' + esc(row ? row.Salesperson || row.SalespersonName || '' : '') + '"><datalist id="fom-cr-reps"></datalist></label><label>Percent (0–100)<input type="number" min="0" max="100" step="any" data-p value="' + esc(row ? row.Percent : 100) + '"></label></div>',
        buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Save', act: 'ok', cls: 'primary' }],
        onOpen: function (d) { FOM.salesReps().then(function (l) { FOM._reps = l; d.q('#fom-cr-reps').innerHTML = l.map(function (r) { return '<option value="' + esc(r.v) + '">'; }).join(''); }); },
        onAction: function (a, d) {
            if (a !== 'ok') return;
            var n = d.q('[data-n]').value.trim(), pc = FOM.num(d.q('[data-p]').value), rep = (FOM._reps || []).filter(function (r) { return r.v === n; })[0];
            if (!n || pc == null || pc < 0 || pc > 100) { FX.toast('Salesperson and a percent between 0 and 100 are required', 'err'); return false; }
            var body = row ? { Salesperson: n, Percent: pc } : { SourceTransactionSalesCreditIdentifier: 'SC-' + E.orderKey + '-' + (E.salesCredits.length + 1), Salesperson: n, SalesCreditTypeId: 1, Percent: pc };
            if (rep && rep.id) body.SalespersonId = rep.id;
            var call = row ? FOM.write('PATCH', FOM.self(row), body, { contentType: null }) : FOM.write('POST', E.orderPath() + '/child/salesCredits', body);
            return call.then(function () { FX.toast('Sales credit saved.', 'ok'); FOM.edLoadCredits(E); return true; }).catch(function (e) { FOM.alert('Sales credit not saved', esc(FOM.emsg(e)), 'err'); return false; });
        }
    });
};

// ── notes & attachments ────────────────────────────────────────
FOM.edNotes = function (E, p) {
    if (!E.orderKey) { p.innerHTML = '<div class="empty"><i class="fa-solid fa-paperclip"></i>Notes and attachments are available once the order is saved.</div>'; return; }
    p.innerHTML = '<div class="fom-2col" style="padding:12px"><div><div class="row-btns"><h4 style="margin:0">Notes</h4><span class="grow"></span><button class="btn sm primary" data-nn><i class="fa-solid fa-plus"></i> New note</button></div><div data-notes style="margin-top:8px"></div></div>' +
        '<div><div class="row-btns"><h4 style="margin:0">Attachments</h4><span class="grow"></span><button class="btn sm primary" data-na><i class="fa-solid fa-paperclip"></i> Add attachment</button></div><div data-att style="margin-top:8px"></div></div></div>';
    var notes = [], atts = [];
    function loadNotes() { p.querySelector('[data-notes]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>'; FOM.get(E.orderPath() + '/child/notes', { limit: 100, onlyData: false }).then(function (j) { notes = j.items || []; p.querySelector('[data-notes]').innerHTML = notes.length ? notes.map(function (n, i) { return '<div class="fom-note"><div class="row-btns"><span class="chip ' + (n.VisibilityCode === 'EXTERNAL' ? 'done' : '') + '">' + esc(n.VisibilityCode || 'INTERNAL') + '</span><span class="chip">' + esc(n.NoteTypeCode || 'GENERAL') + '</span><span class="muted" style="font-size:.72rem">' + esc(FOM.d(n.CreationDate)) + '</span><span class="grow"></span><button class="btn sm icon" data-ne="' + i + '"><i class="fa-solid fa-pen"></i></button><button class="btn sm icon" disabled title="' + esc(FOM.NO_DELETE) + '"><i class="fa-solid fa-trash"></i></button></div><div class="txt">' + esc(n.NoteTxt || '') + '</div></div>'; }).join('') : '<div class="empty" style="padding:16px"><i class="fa-regular fa-note-sticky"></i>No notes.</div>'; }).catch(function (e) { p.querySelector('[data-notes]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; }); }
    function icon(a) { var t = String(a.DatatypeCode || ''), f = String(a.FileName || a.UploadedFileName || '').toLowerCase(); return t === 'WEB_PAGE' ? 'fa-link' : t === 'TEXT' ? 'fa-file-lines' : /\.pdf$/.test(f) ? 'fa-file-pdf' : /\.(png|jpe?g|gif|bmp)$/.test(f) ? 'fa-file-image' : /\.(xlsx?|csv)$/.test(f) ? 'fa-file-excel' : 'fa-file'; }
    function loadAtts() { p.querySelector('[data-att]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>'; FOM.get(E.orderPath() + '/child/attachments', { limit: 100, onlyData: false }).then(function (j) { atts = j.items || []; p.querySelector('[data-att]').innerHTML = atts.length ? atts.map(function (a, i) { return '<div class="fom-note"><div class="row-btns"><i class="fa-solid ' + icon(a) + '" style="color:var(--accent)"></i><b>' + esc(a.Title || a.FileName || a.UploadedFileName || 'Attachment') + '</b><span class="chip">' + esc(a.DatatypeCode || '') + '</span><span class="grow"></span><button class="btn sm" data-ap="' + i + '">Open</button><button class="btn sm icon" disabled title="' + esc(FOM.NO_DELETE) + '"><i class="fa-solid fa-trash"></i></button></div></div>'; }).join('') : '<div class="empty" style="padding:16px"><i class="fa-solid fa-paperclip"></i>No attachments.</div>'; }).catch(function (e) { p.querySelector('[data-att]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; }); }
    function noteDlg(n) {
        FOM.dlg({ title: n ? 'Edit note' : 'New note', body: '<div class="form"><label class="wide">Note<textarea rows="5" data-t>' + esc(n ? n.NoteTxt : '') + '</textarea></label><label>Visibility<select data-v>' + FOM.opts(['INTERNAL', 'EXTERNAL'], n ? n.VisibilityCode : 'INTERNAL') + '</select></label></div>', buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Save', act: 'ok', cls: 'primary' }], onAction: function (a, d) {
            if (a !== 'ok') return; var t = d.q('[data-t]').value.trim(); if (!t) { FX.toast('Write the note first', 'err'); return false; }
            var call = n ? FOM.write('PATCH', FOM.self(n), { NoteTxt: t, VisibilityCode: d.q('[data-v]').value }, { contentType: null }) : FOM.write('POST', E.orderPath() + '/child/notes', { NoteTxt: t, NoteTypeCode: 'GENERAL', VisibilityCode: d.q('[data-v]').value });
            return call.then(function () { loadNotes(); return true; }).catch(function (e) { FOM.alert('Note not saved', esc(FOM.emsg(e)), 'err'); return false; });
        } });
    }
    function attDlg() {
        var file = null;
        FOM.dlg({ title: 'Add attachment', body: '<div class="seg" data-ty><button class="on" data-t="FILE">File</button><button data-t="TEXT">Text</button><button data-t="WEB_PAGE">Web page</button></div><div class="form"><label class="wide">Title<input data-ti></label><label class="wide" data-w="FILE">File<input type="file" data-f></label><label class="wide" data-w="TEXT" hidden>Text<textarea rows="4" data-tx></textarea></label><label class="wide" data-w="WEB_PAGE" hidden>URL<input data-u placeholder="https://…"></label></div>', buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Add', act: 'ok', cls: 'primary' }],
            onOpen: function (d) { d.ty = 'FILE'; d.q('[data-ty]').onclick = function (e) { var b = e.target.closest('[data-t]'); if (!b) return; d.ty = b.getAttribute('data-t'); d.qa('[data-ty] button').forEach(function (x) { x.classList.toggle('on', x === b); }); d.qa('[data-w]').forEach(function (x) { x.hidden = x.getAttribute('data-w') !== d.ty; }); }; d.q('[data-f]').onchange = function () { file = this.files[0] || null; }; },
            onAction: function (a, d) {
                if (a !== 'ok') return; var title = d.q('[data-ti]').value.trim(), body;
                var send = function (b) { return FOM.write('POST', E.orderPath() + '/child/attachments', b).then(function () { loadAtts(); return true; }).catch(function (e) { FOM.alert('Attachment not added', esc(FOM.emsg(e)), 'err'); return false; }); };
                if (d.ty === 'TEXT') { var t = d.q('[data-tx]').value; if (!t.trim()) { FX.toast('Enter the text', 'err'); return false; } return send({ DatatypeCode: 'TEXT', Title: title || 'Text', CategoryName: 'MISC', UploadedText: t }); }
                if (d.ty === 'WEB_PAGE') { var u = d.q('[data-u]').value.trim(); if (!/^https?:\/\//i.test(u)) { FX.toast('Enter a full URL', 'err'); return false; } return send({ DatatypeCode: 'WEB_PAGE', Title: title || u, CategoryName: 'MISC', Url: u }); }
                if (!file) { FX.toast('Choose a file', 'err'); return false; }
                if (file.size > 8 * 1024 * 1024) { FX.toast('Files up to 8 MB', 'err'); return false; }
                return new Promise(function (res) { var r = new FileReader(); r.onload = function () { var b64 = String(r.result).split(',')[1] || ''; res(send({ DatatypeCode: 'FILE', FileName: file.name, UploadedFileName: file.name, UploadedFileContentType: file.type || 'application/octet-stream', Title: title || file.name, CategoryName: 'MISC', FileContents: b64 })); }; r.readAsDataURL(file); });
            } });
    }
    p.querySelector('[data-nn]').onclick = function () { noteDlg(null); };
    p.querySelector('[data-na]').onclick = attDlg;
    p.onclick = function (e) {
        var ne = e.target.closest('[data-ne]'); if (ne) { noteDlg(notes[+ne.getAttribute('data-ne')]); return; }
        var ap = e.target.closest('[data-ap]'); if (!ap) return; var a = atts[+ap.getAttribute('data-ap')];
        if (a.DatatypeCode === 'WEB_PAGE' && a.Url) window.open(a.Url, '_blank');
        else if (a.DatatypeCode === 'TEXT') FOM.alert(esc(a.Title || 'Text'), esc(a.UploadedText || a.Description || ''));
        else FOM.alert(esc(a.Title || a.FileName || 'File'), 'File attachments are stored in Fusion. ' + (a.FileUrl ? 'Open <a href="' + esc(a.FileUrl) + '" target="_blank">' + esc(a.FileName || 'the file') + '</a> (Fusion sign-in).' : 'Open it from the order in Fusion.') + '\nThe app\'s Fusion relay returns text only, so binary downloads are not previewed here.');
    };
    loadNotes(); loadAtts();
};

// ── credit check + validations ─────────────────────────────────
FOM.custActivity = function (acct) {
    return FX.get('receivablesCustomerAccountSiteActivities', { q: 'AccountNumber=' + FOM.qv(acct), limit: 50 }).then(function (j) { return (j.items || [])[0] || null; });
};
FOM.openSchedules = function (siteUseId) {
    return FX.get('receivablesCustomerAccountSiteActivities/' + encodeURIComponent(siteUseId) + '/child/transactionPaymentSchedules', { q: "InstallmentStatus='Open'", limit: 500, offset: 0 }).then(function (j) { return j.items || []; });
};
FOM.aging = function (rows) {
    var b = { cur: 0, o30: 0, o60: 0, o90: 0 }, today = new Date(FX.today() + 'T00:00:00');
    rows.forEach(function (r) {
        var amt = FOM.n(FOM.pf(r, ['TotalBalanceAmount', 'ScheduleAmount', 'Amount', 'InstallmentAmount', 'RemainingAmount'])), due = FOM.pf(r, ['PaymentScheduleDueDate', 'ScheduledPaymentDate', 'DueDate', 'ScheduleDate', 'PaymentDate']);
        var days = FOM.num(r.PaymentDaysLate); if (days == null) days = due ? Math.floor((today - new Date(String(due).slice(0, 10) + 'T00:00:00')) / 864e5) : 0;
        r._amt = amt; r._due = due; r._days = days; r._bucket = days <= 30 ? 'Current' : days <= 60 ? 'Over 30' : days <= 90 ? 'Over 60' : 'Over 90';
        b[days <= 30 ? 'cur' : days <= 60 ? 'o30' : days <= 90 ? 'o60' : 'o90'] += amt;
    });
    return b;
};
FOM.edCredit = function (E, p) {
    p.innerHTML = '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px"><div class="row-btns"><button class="btn primary" data-go><i class="fa-solid fa-scale-balanced"></i> Get Customer Balance</button><span class="muted" style="font-size:.76rem">Customer ' + esc(E.hdr.customerName || '—') + ' · account ' + esc(E.hdr.accountNumber || '—') + '</span></div><div data-r></div></div>';
    p.querySelector('[data-go]').onclick = function () {
        if (!E.hdr.accountNumber) { FX.toast('Pick the customer first', 'err'); return; }
        var r = p.querySelector('[data-r]'); r.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading receivables…';
        FOM.custActivity(E.hdr.accountNumber).then(function (a) {
            if (!a) { r.innerHTML = '<div class="note warn">No receivables activity for account ' + esc(E.hdr.accountNumber) + '.</div>'; return; }
            return FOM.openSchedules(a.BillToSiteUseId).catch(function () { return []; }).then(function (sch) {
                var bal = FOM.n(a.TotalOpenReceivablesForSite), lim = FOM.num(E.hdr.creditLimit), tot = FOM.edTotals(E).lineTotal, avail = lim != null ? lim - bal : null, pass = avail != null && tot <= avail, ag = FOM.aging(sch), c = E.ccy();
                r.innerHTML = '<div class="kpis"><div class="kpi"><b>' + FOM.amt(bal) + '</b><span>Balance</span></div><div class="kpi"><b>' + (lim != null ? FOM.amt(lim) : '—') + '</b><span>Credit limit</span></div><div class="kpi"><b>' + FOM.amt(tot) + '</b><span>Order total</span></div><div class="kpi"><b>' + (avail != null ? FOM.amt(avail) : '—') + '</b><span>Available</span></div><div class="kpi"><b><span class="chip ' + (lim == null ? 'warn' : pass ? 'ok' : 'err') + '" style="font-size:.9rem">' + (lim == null ? 'NO LIMIT' : pass ? 'PASS' : 'FAIL') + '</span></b><span>Credit check</span></div></div>' +
                    '<div class="kpis">' + [['Current', ag.cur], ['Over 30', ag.o30], ['Over 60', ag.o60], ['Over 90', ag.o90]].map(function (x, i) { return '<div class="kpi"><b style="color:' + (i > 1 && x[1] ? 'var(--err)' : 'inherit') + '">' + FOM.amt(x[1]) + '</b><span>' + x[0] + ' (' + esc(c) + ')</span></div>'; }).join('') + '</div>' +
                    '<div><button class="btn sm" data-oi' + (sch.length ? '' : ' disabled') + '><i class="fa-solid fa-file-invoice"></i> Show Open Invoices (' + sch.length + ')</button></div>';
                r.querySelector('[data-oi]').onclick = function () { FOM.dlg({ title: 'Open invoices — ' + esc(E.hdr.customerName), wide: true, body: FOM.table(sch, [{ f: 'TransactionNumber', label: 'Transaction' }, { label: 'Amount', n: 1, html: function (x) { return FOM.amt(x._amt); } }, { label: 'Due Date', html: function (x) { return esc(FOM.d(x._due)); } }, { label: 'Days Overdue', n: 1, html: function (x) { return x._days > 0 ? '<b style="color:var(--err)">' + x._days + '</b>' : String(x._days); } }, { label: 'Aging Bucket', html: function (x) { return '<span class="chip ' + (x._bucket === 'Current' ? 'ok' : x._bucket === 'Over 30' ? 'warn' : 'err') + '">' + x._bucket + '</span>'; } }]) }); };
            });
        }).catch(function (e) { r.innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
    };
};
FOM.edValidations = function (E, p) {
    E.valPane = p;
    p.innerHTML = '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px"><div class="row-btns"><button class="btn primary" data-go><i class="fa-solid fa-list-check"></i> Validate Order</button><span class="muted" style="font-size:.76rem">Credit, overdue invoices, margin and returned cheques.</span></div><div data-r class="fom-vals">' + (E.valHtml || '') + '</div></div>';
    p.querySelector('[data-go]').onclick = function () { FOM.edRunValidations(E); };
};
FOM.edRunValidations = function (E) {
    var out = function (h) { E.valHtml = h; var r = E.valPane && E.valPane.querySelector('[data-r]'); if (r) r.innerHTML = h; };
    if (!E.hdr.accountNumber) { out('<div class="note err">Pick the customer (account number) first.</div>'); return; }
    out('<i class="fa-solid fa-circle-notch fa-spin"></i> Validating…');
    var card = function (name, ok, msg) { return '<div class="fom-val ' + (ok === true ? 'ok' : ok === false ? 'err' : 'warn') + '"><i class="fa-solid ' + (ok === true ? 'fa-circle-check' : ok === false ? 'fa-circle-xmark' : 'fa-circle-question') + '"></i><div><b>' + name + ' — ' + (ok === true ? 'PASS' : ok === false ? 'FAIL' : 'N/A') + '</b><span>' + msg + '</span></div></div>'; };
    var t = FOM.edTotals(E), res = [];
    FOM.custActivity(E.hdr.accountNumber).then(function (a) {
        var bal = a ? FOM.n(a.TotalOpenReceivablesForSite) : 0, lim = FOM.num(E.hdr.creditLimit);
        if (lim == null) res.push(card('Credit', null, 'No credit limit known for the customer (balance ' + FOM.amt(bal) + ').'));
        else res.push(card('Credit', t.lineTotal <= lim - bal, 'Order ' + FOM.amt(t.lineTotal) + ' vs available ' + FOM.amt(lim - bal) + ' (limit ' + FOM.amt(lim) + ' − balance ' + FOM.amt(bal) + ').'));
        if (!a) { res.push(card('Overdue invoices', true, 'No receivables activity for the account.')); res.push(card('Returned cheques', true, 'No receivables activity for the account.')); return; }
        return Promise.all([
            FOM.openSchedules(a.BillToSiteUseId).then(function (s) { var od = s.filter(function (x) { return FOM.n(x.PaymentDaysLate) > 0; }); res.push(card('Overdue invoices', !od.length, od.length ? od.length + ' open installment(s) are overdue.' : 'Nothing overdue (' + s.length + ' open).')); }).catch(function (e) { res.push(card('Overdue invoices', null, esc(FOM.emsg(e)))); }),
            // source bug fixed: it used header billToCustomerId (never set) → always PASS; the activity key is the bill-to site use id
            FX.get('receivablesCustomerAccountSiteActivities/' + encodeURIComponent(a.BillToSiteUseId) + '/child/standardReceiptApplications', { limit: 500, offset: 0 }).then(function (j) { var bad = (j.items || []).filter(function (x) { return /check/i.test(x.ReceiptMethod || '') && /returned|dishonou?red|reversed/i.test(x.Status || x.ReceiptStatus || ''); }); res.push(card('Returned cheques', !bad.length, bad.length ? bad.length + ' returned / dishonored cheque(s).' : 'No returned cheques.')); }).catch(function (e) { res.push(card('Returned cheques', null, 'Could not check: ' + esc(FOM.emsg(e)))); })
        ]);
    }).catch(function (e) { res.push(card('Credit', null, esc(FOM.emsg(e)))); }).then(function () {
        var m = FOM.sum(E.lines.filter(function (l) { return !l.canceled; }), function (l) { return FOM.lineTotal(l) - FOM.n(l.qty) * FOM.n(l.costUnit); });
        var noCost = E.lines.filter(function (l) { return l.itemNumber && l.costUnit == null && !l.canceled; }).length;
        res.splice(2, 0, card('Margin', m >= 0, 'Total margin ' + FOM.amt(m) + (noCost ? ' (' + noCost + ' line(s) without cost)' : '') + '.'));
        out(res.join(''));
    });
};

// ── reservations hub ───────────────────────────────────────────
FOM.edReservations = function (E) {
    var draft = E.isDraft(), rows = [];
    var d = FOM.dlg({ title: '<i class="fa-solid fa-lock"></i> Reservations — ' + esc(E.orderNumber), xwide: true, body: '<div data-tabs></div>' });
    var tabs = FOM.tabs(d.q('[data-tabs]'), [
        { id: 'view', label: 'View', fresh: true, render: function (p) {
            p.innerHTML = '<div style="padding:8px 0"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';
            FOM.fetchReservations(E.orderNumber, FOM.distinct(E.lines.map(function (l) { return l.itemNumber; }))).then(function (r) { E.resCount = r.length; E.drawToolbar(); p.innerHTML = '<div class="row-btns" style="margin:8px 0"><span class="muted" style="font-size:.76rem">Demand source ' + esc(E.orderNumber) + '</span><span class="grow"></span><button class="btn sm" disabled title="' + esc(FOM.NO_DELETE) + '"><i class="fa-solid fa-lock-open"></i> Unreserve</button></div>' + FOM.table(r, FOM.RES_COLS, { empty: 'No reservations for order ' + E.orderNumber + '.', icon: 'fa-lock-open' }); }).catch(function (e) { p.innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
        } },
        { id: 'create', label: 'Create', render: function (p) {
            if (!draft) { p.innerHTML = '<div class="note warn" style="margin-top:8px">Reservations are only allowed while the order is a draft.</div>'; return; }
            if (!E.hdr.warehouse) { p.innerHTML = '<div class="note warn" style="margin-top:8px">Pick a warehouse first.</div>'; return; }
            p.innerHTML = '<div style="padding:8px 0"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading on-hand per line…</div>';
            var ls = E.lines.filter(function (l) { return !l.canceled && l.itemNumber && FOM.n(l.qty) > 0; });
            FOM.orgs().then(function (orgs) {
                var whOrg = (orgs.filter(function (o) { return o.OrganizationCode === E.hdr.warehouse; })[0] || {}).OrganizationId;
                return FOM.mapLimit(ls, 3, function (l) { return FOM.reserveOptions(l.itemNumber, E.hdr.warehouse, E.hdr.subinventory).then(function (r) { var def = r.options.filter(function (o) { return o.lot && o.lot === l.lot; })[0] || r.options[0] || {}; return { l: l, itemId: r.itemId, orgId: r.orgId || whOrg, options: r.options, lotCtl: r.lotControlled, lot: def.lot || '', sub: def.subinventory || E.hdr.subinventory || '', qty: FOM.n(l.qty) }; }).catch(function (e) { return { l: l, options: [], err: FOM.emsg(e), qty: FOM.n(l.qty), sub: E.hdr.subinventory }; }); });
            }).then(function (r) {
                rows = r;
                p.innerHTML = FOM.table(rows, [{ label: 'Item', html: function (x) { return '<span class="mono">' + esc(x.l.itemNumber) + '</span>' + (x.err ? '<div style="color:var(--err);font-size:.7rem">' + esc(x.err) + '</div>' : ''); } }, { label: 'Lot / subinventory', html: function (x, i) { return x.options.length ? '<select class="fom-in" data-ro="' + i + '">' + x.options.map(function (o, j) { return '<option value="' + j + '"' + (o.lot === x.lot && o.subinventory === x.sub ? ' selected' : '') + '>' + esc((o.lot || 'no lot') + ' · ' + (o.subinventory || '—') + ' · ' + FOM.qty(o.qty)) + '</option>'; }).join('') + '</select>' : '<span class="muted">no on-hand</span>'; } }, { label: 'Qty', n: 1, html: function (x) { return FOM.qty(x.qty) + ' ' + esc(x.l.uom || ''); } }, { label: 'Item / Org Id', html: function (x) { return '<span class="mono" style="font-size:.68rem">' + esc(x.itemId || '?') + ' / ' + esc(x.orgId || '?') + '</span>'; } }, { label: 'Result', html: function (x, i) { return '<span data-rr="' + i + '"></span>'; } }], { empty: 'No lines to reserve.' }) +
                    '<div class="row-btns" style="margin-top:8px"><span class="grow"></span><button class="btn sm" data-copy><i class="fa-regular fa-copy"></i> Copy all</button><button class="btn primary" data-run' + (rows.length ? '' : ' disabled') + '><i class="fa-solid fa-lock"></i> Run</button></div>';
                p.onchange = function (e) { var s = e.target.closest('[data-ro]'); if (!s) return; var x = rows[+s.getAttribute('data-ro')], o = x.options[+s.value]; x.lot = o.lot; x.sub = o.subinventory; };
                var body = function (x) { var b = { InventoryItemId: x.itemId, OrganizationId: x.orgId, DemandSourceType: 'User Defined', DemandSourceName: E.orderNumber, SupplySourceType: 'On hand', ReservationUOMCode: x.l.uom, SubinventoryCode: x.sub, ReservationQuantity: x.qty, LotNumber: x.lot }; Object.keys(b).forEach(function (k) { if (b[k] == null || b[k] === '') delete b[k]; }); return b; };
                p.querySelector('[data-copy]').onclick = function () { FOM.copy(rows.map(function (x) { return 'POST ' + FOM.u('inventoryReservations') + '\n' + JSON.stringify(body(x), null, 2); }).join('\n\n')); };
                p.querySelector('[data-run]').onclick = function () {
                    var miss = rows.filter(function (x) { return x.lotCtl && (!x.lot || !x.sub); }).map(function (x) { return x.l.itemNumber; });
                    if (miss.length) { FX.toast('Select a lot & subinventory for: ' + miss.join(', '), 'err'); return; }
                    var btn = this; btn.disabled = true;
                    FOM.mapLimit(rows, 1, function (x, i) {
                        var cell = p.querySelector('[data-rr="' + i + '"]'); cell.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
                        return FOM.raw('POST', 'inventoryReservations', { contentType: 'json' }, body(x)).then(function (r) { cell.innerHTML = r.ok ? '<span class="chip ok">' + r.status + ' reserved</span>' : '<span class="chip err" title="' + esc(FOM.errs(r.json, r.text, r.status).join('\n')) + '">' + r.status + ' ' + esc(FOM.errs(r.json, r.text, r.status)[0]).slice(0, 80) + '</span>'; });
                    }).then(function () { btn.disabled = false; FOM.edResCount(E); setTimeout(function () { tabs.show('view'); }, 900); });
                };
            });
        } }
    ], { start: E.resCount ? 'view' : 'create' });
};

// ── branch sales → branch PO ───────────────────────────────────
FOM.CCY_NAMES = { USD: 'US Dollar', AED: 'United Arab Emirates Dirham', KES: 'Kenyan Shilling', EUR: 'Euro', GBP: 'British Pound' };
FOM.branchPoNumber = function (so) { var s = String(so || ''), strip = FOM.cfg('soPrefixStrip'); return FOM.cfg('poPrefix') + (strip && s.indexOf(strip) === 0 ? s.slice(strip.length) : s); };
FOM.branchPoDlg = function (E) {
    var h = E.hdr, P = { bu: null, supplier: '', site: '', shipOrg: '', needBy: FOM.days(+FOM.cfg('needByDays') || 7), currency: h.txnCurrency, orgs: [] };
    var lines = E.lines.filter(function (l) { return l.itemNumber && FOM.n(l.qty) > 0 && !l.canceled; });
    var d = FOM.dlg({
        title: '<i class="fa-solid fa-code-branch"></i> Branch purchase order', xwide: true,
        body: '<div class="form"><label>Sales Order Number<input value="' + esc(E.orderNumber) + '" readonly></label><label>PO Number (preview)<input value="' + esc(FOM.branchPoNumber(E.orderNumber)) + '" readonly></label>' +
            '<label><span>Branch Business Unit <b class="r">*</b></span><select data-b><option>Loading…</option></select></label><label><span>Branch Supplier <b class="r">*</b></span><div class="fom-inbtn"><input data-sup readonly placeholder="Search…"><button class="btn sm" data-ss><i class="fa-solid fa-magnifying-glass"></i></button></div></label>' +
            '<label><span>Supplier Site <b class="r">*</b></span><input data-site readonly></label><label><span>Ship-To Location (org) <b class="r">*</b></span><select data-org><option value="">Select the BU first</option></select></label>' +
            '<label>Currency<input data-ccy value="' + esc(P.currency || '') + '"></label><label>Need-By Date<input type="date" data-nb value="' + P.needBy + '"></label>' +
            '<label>Base currency<input data-base readonly></label><label>Conversion rate (Trx → Base)<input value="' + esc(h.rate || 1) + '" readonly></label></div>' +
            '<h4>Lines</h4>' + FOM.table(lines, [{ f: 'itemNumber', label: 'Item', mono: 1 }, { f: 'description', label: 'Description' }, { f: 'qty', label: 'Qty', n: 1, fmt: 'qty' }, { label: 'UOM', html: function (l) { return esc(l.uom || 'EA'); } }, { f: 'unitPrice', label: 'Unit Price', n: 1, fmt: 'amt' }, { label: 'Line Total', n: 1, html: function (l) { return FOM.amt(FOM.n(l.qty) * FOM.n(l.unitPrice)); } }], { empty: 'No lines with quantity.' }) + '<div data-res></div>',
        buttons: [{ label: 'View API', act: 'api' }, { label: 'Close', act: 'close' }, { label: 'Create Branch PO', act: 'go', cls: 'primary' }],
        onOpen: function (dd) {
            FOM.bus().then(function (l) { P.buList = l; dd.q('[data-b]').innerHTML = '<option value="">Select…</option>' + FOM.opts(l.map(function (b) { return { v: b.v, t: b.t }; }), (l.filter(function (b) { return b.t === h.branchBU; })[0] || {}).v || ''); if (dd.q('[data-b]').value) buChange(); });
            function buChange() {
                P.bu = P.buList.filter(function (b) { return b.v === dd.q('[data-b]').value; })[0] || null; P.supplier = ''; P.site = ''; dd.q('[data-sup]').value = ''; dd.q('[data-site]').value = '';
                dd.q('[data-base]').value = P.bu ? P.bu.ccy : ''; dd.q('[data-nb]').value = FOM.days(+FOM.cfg('needByDays') || 7);
                if (!P.bu) return;
                dd.q('[data-org]').innerHTML = '<option>Loading…</option>';
                FX.get('inventoryOrganizations', { q: 'ManagementBusinessUnitName=' + FOM.qv(P.bu.t), limit: 500 }).then(function (j) { return j.items || []; }).catch(function () { return []; }).then(function (l) {
                    if (!l.length) return FOM.orgs().then(function (all) { return all.filter(function (o) { return o.BusinessUnitName === P.bu.t || o.ManagementBusinessUnitName === P.bu.t; }); });
                    return l;
                }).then(function (l) { P.orgs = l; dd.q('[data-org]').innerHTML = '<option value="">Select…</option>' + l.map(function (o) { return '<option value="' + esc(o.OrganizationCode) + '">' + esc(o.OrganizationCode + ' — ' + (o.OrganizationName || '')) + '</option>'; }).join(''); });
            }
            dd.q('[data-b]').onchange = buChange;
            dd.q('[data-ss]').onclick = function () {
                if (!P.bu) { FX.toast('Select the branch business unit first', 'err'); return; }
                FOM.supplierSearch(P.bu.t).then(function (r) { if (!r) return; P.supplier = r.supplier; P.site = r.site; dd.q('[data-sup]').value = r.supplier; dd.q('[data-site]').value = r.site; });
            };
        },
        onAction: function (a, dd, btn) {
            P.shipOrg = dd.q('[data-org]').value; P.currency = dd.q('[data-ccy]').value.trim(); P.needBy = dd.q('[data-nb]').value;
            var body = function () {
                var org = P.orgs.filter(function (o) { return o.OrganizationCode === P.shipOrg; })[0] || {}, rate = FOM.num(h.rate) || 1;
                return { ProcurementBUId: P.bu ? +P.bu.v : null, OrderNumber: FOM.branchPoNumber(E.orderNumber), RequiredAcknowledgment: 'None', CurrencyCode: P.currency, Currency: FOM.CCY_NAMES[P.currency] ? P.currency + ' ' + FOM.CCY_NAMES[P.currency] : P.currency,
                    ConversionRateTypeCode: rate !== 1 ? h.currencyRateType || 'Corporate' : null, ConversionRateType: rate !== 1 ? h.currencyRateType || 'Corporate' : null, ConversionRateDate: rate !== 1 && h.currencyDate ? String(h.currencyDate).slice(0, 10) : null, ConversionRate: rate !== 1 ? rate : null,
                    Buyer: FOM.cfg('buyer'), PayOnReceiptFlag: 'Y', RequisitioningBUId: P.bu ? +P.bu.v : null, Supplier: P.supplier, SupplierSite: P.site, BillToLocation: P.bu ? P.bu.t : null, DefaultShipToLocation: P.shipOrg, ModeOfTransportCode: null, BuyerManagedTransportFlag: false, SupplierEmailAddress: null,
                    lines: lines.map(function (l, i) { return { LineNumber: i + 1, LineType: 'Goods', Item: l.itemNumber, Description: l.description, Quantity: FOM.n(l.qty), Price: FOM.n(l.unitPrice), UOM: l.uom || 'EA', schedules: [{ ScheduleNumber: 1, Quantity: FOM.n(l.qty), ShipToLocation: P.shipOrg, ShipToOrganizationCode: P.shipOrg, ShipToOrganization: org.OrganizationName, RequestedDeliveryDate: P.needBy, ReceiptCloseTolerancePercent: 0, InvoiceMatchOptionCode: 'P', InvoiceMatchOption: 'Order', EarlyReceiptToleranceDays: 0, InvoiceCloseTolerancePercent: 0, LateReceiptToleranceDays: 0, AccrueAtReceiptFlag: true, InspectionRequiredFlag: true, ReceiptRequiredFlag: false, ReceiptRoutingId: 3, ReceiptRouting: 'Direct delivery', DestinationTypeCode: 'INVENTORY', MatchApprovalLevelCode: '3-Way', MatchApprovalLevel: '3 Way', distributions: [{ DistributionNumber: 1, DeliverToLocation: P.shipOrg, DeliverToLocationCode: P.shipOrg, Quantity: FOM.n(l.qty) }] }] }; }) };
            };
            if (a === 'api') { FOM.json('POST ' + FOM.u('draftPurchaseOrders'), body()); return false; }
            if (a !== 'go') return;
            var miss = []; if (!P.bu) miss.push('Branch Business Unit'); if (!P.supplier) miss.push('Branch Supplier'); if (!P.site) miss.push('Supplier Site'); if (!P.shipOrg) miss.push('Ship-To Location'); if (!lines.length) miss.push('lines with quantity');
            if (miss.length) { dd.q('[data-res]').innerHTML = '<div class="note err">Missing: ' + esc(miss.join(', ')) + '</div>'; return false; }
            btn.disabled = true; dd.q('[data-res]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creating the purchase order…';
            FOM.write('POST', 'draftPurchaseOrders', body()).then(function (j) { btn.disabled = false; var po = j.OrderNumber || j.PurchaseOrderNumber; dd.q('[data-res]').innerHTML = '<div class="note ok">Branch PO <b>' + esc(po || '(created)') + '</b> created as a draft.</div>'; E.branchPo = po; FX.toast('Branch PO ' + (po || '') + ' created', 'ok'); })
                .catch(function (e) { btn.disabled = false; dd.q('[data-res]').innerHTML = '<div class="note err" style="white-space:pre-wrap">' + esc(FOM.emsg(e)) + '</div>'; });
            return false;
        }
    });
};
/** Supplier + site search (§3.3.24) → Promise<{supplier, site}|null>; sites filtered to the branch BU. */
FOM.supplierSearch = function (buName) {
    return new Promise(function (res) {
        var out = null, list = [];
        var d = FOM.dlg({ title: 'Find branch supplier', wide: true, body: '<div class="row-btns"><input class="fom-in" data-q placeholder="Supplier name or number (2+ characters)" style="flex:1"><button class="btn primary" data-s><i class="fa-solid fa-magnifying-glass"></i> Search</button></div><div data-r></div>', onClose: function () { res(out); } });
        function go() {
            var t = d.q('[data-q]').value.trim(); if (t.length < 2) { FX.toast('Type at least 2 characters', 'err'); return; }
            d.q('[data-r]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
            var tt = t.replace(/'/g, "''");
            FX.get('suppliers', { q: "Supplier LIKE '*" + tt + "*' OR SupplierNumber LIKE '*" + tt + "*'", limit: 20, expand: 'sites' }).then(function (j) {
                list = j.items || [];
                d.q('[data-r]').innerHTML = FOM.table(list, [{ f: 'SupplierNumber', label: 'Supplier #', mono: 1 }, { label: 'Supplier Name', html: function (s) { return esc(s.SupplierName || s.Supplier); } }, { label: 'Status', html: function (s) { return FX.chip(s.SupplierStatus || s.Status); } }, { label: '', html: function (s, i) { return '<button class="btn sm primary" data-pk="' + i + '">Choose</button>'; } }], { empty: 'No suppliers found.' });
            }).catch(function (e) { d.q('[data-r]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
        }
        d.q('[data-s]').onclick = go; d.q('[data-q]').onkeydown = function (e) { if (e.key === 'Enter') go(); };
        d.box.addEventListener('click', function (e) {
            var b = e.target.closest('[data-pk]'); if (!b) return;
            var s = list[+b.getAttribute('data-pk')], name = s.SupplierName || s.Supplier;
            var sites = (s.sites || []).filter(function (x) { return !buName || (x.ProcurementBU || x.ProcurementBUName) === buName; });
            var code = function (x) { return x.SupplierSite || x.VendorSiteCode || x.SiteCode; };
            if (!sites.length) { FX.toast('No sites found for ' + buName, 'err'); return; }
            if (sites.length === 1) { out = { supplier: name, site: code(sites[0]) }; d.close(); return; }
            var sd = FOM.dlg({ title: 'Choose a site — ' + esc(name), body: FOM.table(sites, [{ label: 'Site Code', html: function (x) { return '<b>' + esc(code(x)) + '</b>'; } }, { f: 'SupplierSiteName', label: 'Site Name' }, { label: 'Status', html: function (x) { return esc(x.Status || x.SiteStatus || ''); } }, { label: '', html: function (x, i) { return '<button class="btn sm primary" data-st="' + i + '">Choose</button>'; } }]) });
            sd.box.addEventListener('click', function (e2) { var c = e2.target.closest('[data-st]'); if (c) { out = { supplier: name, site: code(sites[+c.getAttribute('data-st')]) }; sd.close(); d.close(); } });
        });
    });
};

/* Template knowledge for "Prepare & Load": defaults, auto-map synonyms, file checks and live
   Fusion checks (run read-only through the Fusion SQL BIP runner). Column keys are the Oracle DB
   column (or the template label when the workbook has none), matched case-insensitively.

   Live check shape:
     { id, name, sev: 'E'|'W', csv, key(H,row) → value | null, sql(inList) → SELECT … k … ,
       missing: message when the value is NOT found (or present: message when it IS found — duplicates) }
   A check whose query fails (e.g. no access to a view) is reported as "could not run" and never
   blocks generation. */

var FBDI_RULES = {};

/** Helpers a rule gets: value by column key, number, key list. */
function frHelper(sheetOut) {
    var cache = {};
    function ix(key) { if (!(key in cache)) cache[key] = FE.colIndex(sheetOut.spec, key); return cache[key]; }
    return {
        has: function (key) { return ix(key) >= 0; },
        idx: ix,
        v: function (row, key) { var i = ix(key); return i < 0 ? '' : String(row[i] == null ? '' : row[i]).trim(); },
        n: function (row, key) { var i = ix(key); if (i < 0) return 0; var x = Number(row[i]); return isNaN(x) ? 0 : x; }
    };
}
function frSheet(built, csv) { for (var i = 0; i < built.sheets.length; i++) if (built.sheets[i].csv === csv) return built.sheets[i]; return null; }
function frIssue(csv, r, c, sev, check, msg) { return { csv: csv, r: r, c: c, sev: sev, check: check, msg: msg }; }
function frMoney(x) { return (Math.round(x * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ── Journals ────────────────────────────────────────────────────
FBDI_RULES.JournalImportTemplate = {
    title: 'Journals', icon: 'fa-book',
    docKeyHint: 'Optional — e.g. {Journal No}. Gives each journal a number ({#doc}) and line number ({#line}).',
    sheets: { GlInterface: { mode: 'row', role: 'one row per journal line — journals are grouped by batch/journal name, ledger, date and currency' } },
    links: [],
    presets: {
        GlInterface: { STATUS: 'NEW', ACTUAL_FLAG: 'A', 'Journal Entry Creation Date': '{#today}', GROUP_ID: '{#load}' }
    },
    synonyms: {
        ACCOUNTING_DATE: ['accounting date', 'gl date', 'effective date', 'journal date', 'date'],
        USER_JE_SOURCE_NAME: ['source', 'journal source'], USER_JE_CATEGORY_NAME: ['category', 'journal category'],
        CURRENCY_CODE: ['currency', 'currency code', 'curr'], LEDGER_ID: ['ledger id'], LEDGER_NAME: ['ledger', 'ledger name'],
        ENTERED_DR: ['debit', 'dr', 'debit amount', 'entered dr'], ENTERED_CR: ['credit', 'cr', 'credit amount', 'entered cr'],
        'REFERENCE1': ['batch', 'batch name'], 'REFERENCE4': ['journal', 'journal name', 'journal no', 'journal number'],
        'REFERENCE10': ['line description', 'narration', 'description', 'memo'],
        SEGMENT1: ['company', 'segment1', 'entity'], SEGMENT2: ['segment2', 'cost center', 'cost centre', 'department', 'dept', 'cc'], SEGMENT3: ['segment3', 'account', 'natural account'],
        SEGMENT4: ['segment4'], SEGMENT5: ['segment5'], SEGMENT6: ['segment6'], PERIOD_NAME: ['period', 'period name']
    },
    checks: function (built) {
        var s = frSheet(built, 'GlInterface'); if (!s) return [];
        var H = frHelper(s), out = [], bal = {}, keyCols = ['LEDGER_ID', 'LEDGER_NAME', 'ACCOUNTING_DATE', 'CURRENCY_CODE', 'GROUP_ID', 'REFERENCE1', 'REFERENCE4'];
        s.rows.forEach(function (row, r) {
            var dr = H.v(row, 'ENTERED_DR'), cr = H.v(row, 'ENTERED_CR');
            if (!dr && !cr) out.push(frIssue(s.csv, r, H.idx('ENTERED_DR'), 'E', 'drcr', 'Line has neither a debit nor a credit'));
            else if (dr && cr) out.push(frIssue(s.csv, r, H.idx('ENTERED_CR'), 'W', 'drcr', 'Line has both a debit and a credit'));
            var st = H.v(row, 'STATUS'); if (st && st !== 'NEW') out.push(frIssue(s.csv, r, H.idx('STATUS'), 'E', 'status', 'Status Code must be NEW'));
            var af = H.v(row, 'ACTUAL_FLAG'); if (af && !/^[ABE]$/.test(af)) out.push(frIssue(s.csv, r, H.idx('ACTUAL_FLAG'), 'E', 'status', 'Actual Flag must be A (actual), B (budget) or E (encumbrance)'));
            var k = keyCols.map(function (c) { return H.v(row, c); }).join('|');
            (bal[k] = bal[k] || { dr: 0, cr: 0, first: r, rows: 0, name: H.v(row, 'REFERENCE4') || H.v(row, 'ACCOUNTING_DATE') + ' ' + H.v(row, 'CURRENCY_CODE') });
            bal[k].dr += H.n(row, 'ENTERED_DR'); bal[k].cr += H.n(row, 'ENTERED_CR'); bal[k].rows++;
        });
        Object.keys(bal).forEach(function (k) {
            var b = bal[k], diff = Math.round((b.dr - b.cr) * 100) / 100;
            if (Math.abs(diff) >= 0.005)
                out.push(frIssue(s.csv, b.first, H.idx('ENTERED_DR'), 'E', 'balance', 'Journal "' + b.name + '" (' + b.rows + ' lines) is out of balance: debits ' + frMoney(b.dr) + ' vs credits ' + frMoney(b.cr) + ' (difference ' + frMoney(diff) + ')'));
        });
        return out;
    },
    fusion: [
        { id: 'ledger', name: 'Ledger exists', sev: 'E', csv: 'GlInterface', key: function (H, r) { return H.v(r, 'LEDGER_ID') || null; },
          sql: function (IN) { return 'SELECT TO_CHAR(ledger_id) AS k FROM gl_ledgers WHERE TO_CHAR(ledger_id) IN (' + IN + ')'; }, missing: 'Ledger ID {v} does not exist in Fusion' },
        { id: 'ledgername', name: 'Ledger name exists', sev: 'E', csv: 'GlInterface', key: function (H, r) { return H.v(r, 'LEDGER_NAME') || null; },
          sql: function (IN) { return 'SELECT name AS k FROM gl_ledgers WHERE name IN (' + IN + ')'; }, missing: 'Ledger "{v}" does not exist in Fusion' },
        { id: 'source', name: 'Journal source exists', sev: 'E', csv: 'GlInterface', key: function (H, r) { return H.v(r, 'USER_JE_SOURCE_NAME') || null; },
          sql: function (IN) { return 'SELECT user_je_source_name AS k FROM gl_je_sources WHERE user_je_source_name IN (' + IN + ')'; }, missing: 'Journal source "{v}" is not set up' },
        { id: 'category', name: 'Journal category exists', sev: 'E', csv: 'GlInterface', key: function (H, r) { return H.v(r, 'USER_JE_CATEGORY_NAME') || null; },
          sql: function (IN) { return 'SELECT user_je_category_name AS k FROM gl_je_categories WHERE user_je_category_name IN (' + IN + ')'; }, missing: 'Journal category "{v}" is not set up' },
        { id: 'currency', name: 'Currency enabled', sev: 'E', csv: 'GlInterface', key: function (H, r) { return H.v(r, 'CURRENCY_CODE') || null; },
          sql: function (IN) { return "SELECT currency_code AS k FROM fnd_currencies_b WHERE enabled_flag = 'Y' AND currency_code IN (" + IN + ')'; }, missing: 'Currency {v} is not enabled' },
        { id: 'period', name: 'GL period open', sev: 'E', csv: 'GlInterface', custom: 'period' },
        { id: 'ccid', name: 'Account combinations exist', sev: 'W', csv: 'GlInterface', custom: 'ccid' }
    ]
};

// ── Payables invoices ──────────────────────────────────────────
FBDI_RULES.PayablesStandardInvoiceImportTemplate = {
    title: 'Payables Invoices', icon: 'fa-file-invoice-dollar',
    docKeyHint: 'Required — the column that identifies an invoice, e.g. {Invoice No} (or {Vendor}-{Invoice No}). One header per invoice, one line per row.',
    docKeyRequired: true,
    notRequired: ['VENDOR_NAME', 'VENDOR_NUM'],               // one of the two is enough (checked below)
    sheets: { ApInvoicesInterface: { mode: 'doc', role: 'invoice headers — one row per invoice' },
              ApInvoiceLinesInterface: { mode: 'row', role: 'invoice lines — one row per line (item, freight, tax…)' } },
    links: [{ from: 'ApInvoicesInterface', to: 'ApInvoiceLinesInterface', key: 'INVOICE_ID', label: 'Invoice ID' }],
    presets: {
        ApInvoicesInterface: { INVOICE_ID: '{#load}{#doc|pad:5}', SOURCE: 'External', INVOICE_TYPE_LOOKUP_CODE: 'STANDARD' },
        ApInvoiceLinesInterface: { INVOICE_ID: '{#load}{#doc|pad:5}', LINE_NUMBER: '{#line}', LINE_TYPE_LOOKUP_CODE: 'ITEM' }
    },
    synonyms: {
        INVOICE_NUM: ['invoice', 'invoice no', 'invoice number', 'inv no', 'invoice num', 'bill no', 'bill number'],
        VENDOR_NAME: ['vendor', 'supplier', 'vendor name', 'supplier name'], VENDOR_NUM: ['vendor number', 'vendor no', 'supplier number', 'supplier no', 'vendor code', 'supplier code'],
        VENDOR_SITE_CODE: ['site', 'vendor site', 'supplier site'], INVOICE_DATE: ['invoice date', 'inv date', 'bill date', 'date'],
        OPERATING_UNIT: ['business unit', 'bu', 'operating unit', 'ou'], INVOICE_CURRENCY_CODE: ['currency', 'invoice currency', 'curr'],
        TERMS_NAME: ['terms', 'payment terms'], GL_DATE: ['gl date', 'accounting date'], DESCRIPTION: ['description', 'memo', 'narration'],
        AMOUNT: ['amount', 'line amount', 'net amount'], DIST_CODE_CONCATENATED: ['account', 'gl account', 'distribution', 'charge account', 'distribution combination'],
        QUANTITY_INVOICED: ['qty', 'quantity'], UNIT_PRICE: ['price', 'unit price', 'rate']
    },
    checks: function (built) {
        var h = frSheet(built, 'ApInvoicesInterface'), l = frSheet(built, 'ApInvoiceLinesInterface'), out = [];
        if (!h) return out;
        var H = frHelper(h), ids = {}, seen = {};
        h.rows.forEach(function (row, r) {
            if (!H.v(row, 'VENDOR_NAME') && !H.v(row, 'VENDOR_NUM')) out.push(frIssue(h.csv, r, H.idx('VENDOR_NAME'), 'E', 'supplier', 'Give the Supplier Name or the Supplier Number'));
            var id = H.v(row, 'INVOICE_ID');
            if (id) { if (ids[id]) out.push(frIssue(h.csv, r, H.idx('INVOICE_ID'), 'E', 'dup', 'Invoice ID ' + id + ' is used twice')); ids[id] = { r: r, amt: H.n(row, 'INVOICE_AMOUNT'), lines: 0, sum: 0, num: H.v(row, 'INVOICE_NUM') }; }
            var dk = (H.v(row, 'VENDOR_NUM') || H.v(row, 'VENDOR_NAME')) + '|' + H.v(row, 'INVOICE_NUM');
            if (H.v(row, 'INVOICE_NUM')) { if (seen[dk] != null) out.push(frIssue(h.csv, r, H.idx('INVOICE_NUM'), 'E', 'dup', 'Invoice ' + H.v(row, 'INVOICE_NUM') + ' appears twice for the same supplier')); seen[dk] = r; }
            var ty = H.v(row, 'INVOICE_TYPE_LOOKUP_CODE'), amt = H.n(row, 'INVOICE_AMOUNT');
            if (ty === 'CREDIT' && amt > 0) out.push(frIssue(h.csv, r, H.idx('INVOICE_AMOUNT'), 'E', 'sign', 'Credit memo amounts must be negative'));
            if (ty === 'STANDARD' && amt < 0) out.push(frIssue(h.csv, r, H.idx('INVOICE_AMOUNT'), 'W', 'sign', 'Negative amount on a STANDARD invoice — should it be a CREDIT memo?'));
        });
        if (l) {
            var L = frHelper(l), lineNos = {};
            l.rows.forEach(function (row, r) {
                var id = L.v(row, 'INVOICE_ID');
                if (!ids[id]) { out.push(frIssue(l.csv, r, L.idx('INVOICE_ID'), 'E', 'orphan', 'Line points to Invoice ID ' + (id || '(blank)') + ' which has no header')); return; }
                ids[id].lines++; ids[id].sum += L.n(row, 'AMOUNT');
                var ln = id + '|' + L.v(row, 'LINE_NUMBER');
                if (L.v(row, 'LINE_NUMBER')) { if (lineNos[ln]) out.push(frIssue(l.csv, r, L.idx('LINE_NUMBER'), 'E', 'dup', 'Line number ' + L.v(row, 'LINE_NUMBER') + ' repeats on invoice ' + ids[id].num)); lineNos[ln] = 1; }
            });
            Object.keys(ids).forEach(function (id) {
                var x = ids[id];
                if (!x.lines) out.push(frIssue(h.csv, x.r, H.idx('INVOICE_ID'), 'E', 'nolines', 'Invoice ' + x.num + ' has no lines'));
                else if (Math.abs(Math.round((x.amt - x.sum) * 100)) >= 1)
                    out.push(frIssue(h.csv, x.r, H.idx('INVOICE_AMOUNT'), 'E', 'total', 'Invoice ' + x.num + ': amount ' + frMoney(x.amt) + ' ≠ lines total ' + frMoney(x.sum) + ' — map Invoice Amount to {#sum:<line amount column>}'));
            });
        }
        return out;
    },
    fusion: [
        { id: 'bu', name: 'Business unit exists', sev: 'E', csv: 'ApInvoicesInterface', key: function (H, r) { return H.v(r, 'OPERATING_UNIT') || null; },
          sql: function (IN) { return 'SELECT bu_name AS k FROM fun_all_business_units_v WHERE bu_name IN (' + IN + ')'; }, missing: 'Business unit "{v}" does not exist' },
        { id: 'supnum', name: 'Supplier number exists', sev: 'E', csv: 'ApInvoicesInterface', key: function (H, r) { return H.v(r, 'VENDOR_NUM') || null; },
          sql: function (IN) { return 'SELECT segment1 AS k FROM poz_suppliers_v WHERE segment1 IN (' + IN + ')'; }, missing: 'Supplier number {v} does not exist' },
        { id: 'supname', name: 'Supplier name exists', sev: 'E', csv: 'ApInvoicesInterface', key: function (H, r) { return H.v(r, 'VENDOR_NUM') ? null : (H.v(r, 'VENDOR_NAME') || null); },
          sql: function (IN) { return 'SELECT vendor_name AS k FROM poz_suppliers_v WHERE vendor_name IN (' + IN + ')'; }, missing: 'Supplier "{v}" does not exist (names must match exactly)' },
        { id: 'site', name: 'Supplier site exists', sev: 'E', csv: 'ApInvoicesInterface',
          key: function (H, r) { var s = H.v(r, 'VENDOR_SITE_CODE'); return s ? (H.v(r, 'VENDOR_NUM') || H.v(r, 'VENDOR_NAME')) + '|' + s : null; },
          inKey: function (H, r) { return H.v(r, 'VENDOR_SITE_CODE') || null; },
          sql: function (IN) { return "SELECT s.segment1 || '|' || ss.vendor_site_code AS k FROM poz_suppliers_v s JOIN poz_supplier_sites_v ss ON ss.vendor_id = s.vendor_id WHERE ss.vendor_site_code IN (" + IN + ") " +
                "UNION SELECT s.vendor_name || '|' || ss.vendor_site_code FROM poz_suppliers_v s JOIN poz_supplier_sites_v ss ON ss.vendor_id = s.vendor_id WHERE ss.vendor_site_code IN (" + IN + ')'; },
          missing: 'Site {v} does not exist for this supplier' },
        { id: 'dupinv', name: 'Invoice not already in Fusion', sev: 'E', csv: 'ApInvoicesInterface',
          key: function (H, r) { var n = H.v(r, 'INVOICE_NUM'); return n ? (H.v(r, 'VENDOR_NUM') || H.v(r, 'VENDOR_NAME')) + '|' + n : null; },
          inKey: function (H, r) { return H.v(r, 'INVOICE_NUM') || null; },
          sql: function (IN) { return "SELECT s.segment1 || '|' || i.invoice_num AS k FROM ap_invoices_all i JOIN poz_suppliers_v s ON s.vendor_id = i.vendor_id WHERE i.invoice_num IN (" + IN + ") " +
                "UNION SELECT s.vendor_name || '|' || i.invoice_num FROM ap_invoices_all i JOIN poz_suppliers_v s ON s.vendor_id = i.vendor_id WHERE i.invoice_num IN (" + IN + ')'; },
          present: 'Invoice {v} already exists in Fusion' },
        { id: 'currency', name: 'Currency enabled', sev: 'E', csv: 'ApInvoicesInterface', key: function (H, r) { return H.v(r, 'INVOICE_CURRENCY_CODE') || null; },
          sql: function (IN) { return "SELECT currency_code AS k FROM fnd_currencies_b WHERE enabled_flag = 'Y' AND currency_code IN (" + IN + ')'; }, missing: 'Currency {v} is not enabled' }
    ]
};

// ── Inventory transactions ─────────────────────────────────────
FBDI_RULES.InventoryTransactionImportTemplate = {
    title: 'Inventory Transactions', icon: 'fa-boxes-stacked',
    docKeyHint: 'Optional — e.g. {Trip} to number documents; used by SOURCE_HEADER_ID.',
    sheets: { InvTransactionsInterface: { mode: 'row', role: 'one row per material transaction (receipt, issue, transfer…)' },
              InvTransactionLotsInterface: { mode: 'row', include: false, role: 'lot numbers of lot-controlled items — optional' },
              InvSerialNumbersInterface: { mode: 'row', include: false, role: 'serial numbers of serial-controlled items — optional' },
              CstTransCostInterface: { mode: 'row', include: false, role: 'incoming cost per cost component — optional' } },
    links: [{ from: 'InvTransactionsInterface', to: 'InvTransactionLotsInterface', key: 'INV_LOTSERIAL_INTERFACE_NUM', toKey: 'Inventory Lot Interface Number', label: 'Lot interface number' },
            { from: 'InvTransactionLotsInterface', to: 'InvSerialNumbersInterface', key: 'Inventory Serial Interface Number', toKey: 'INV_SERIAL_INTERFACE_NUM', label: 'Serial interface number' },
            { from: 'InvTransactionsInterface', to: 'CstTransCostInterface', key: 'TRANSACTION_COST_IDENTIFIER', label: 'Cost identifier' }],
    presets: {
        InvTransactionsInterface: { PROCESS_FLAG: '1', TRANSACTION_MODE: '3', LOCK_FLAG: '2', SOURCE_CODE: 'WMS',
            SOURCE_HEADER_ID: '{#load}{#doc|pad:5}', SOURCE_LINE_ID: '{#load}{#row|pad:6}' }
    },
    synonyms: {
        ORGANIZATION_NAME: ['organization', 'org', 'organization name', 'warehouse', 'inventory org'],
        ITEM_NUMBER: ['item', 'item number', 'item code', 'sku', 'part', 'part number', 'product'],
        SUBINVENTORY_CODE: ['subinventory', 'subinv', 'sub inventory', 'from subinventory'], LOCATOR_NAME: ['locator', 'bin', 'location'],
        TRANSACTION_QUANTITY: ['qty', 'quantity', 'transaction quantity'], TRANSACTION_UOM: ['uom', 'unit', 'unit of measure'],
        TRANSACTION_DATE: ['date', 'transaction date', 'txn date'], TRANSACTION_TYPE_NAME: ['type', 'transaction type', 'txn type'],
        TRANSACTION_REFERENCE: ['reference', 'ref', 'transaction reference'], REASON_NAME: ['reason'],
        TRANSFER_SUBINVENTORY: ['to subinventory', 'to subinv', 'transfer subinventory'], TRANSFER_ORGANIZATION_NAME: ['to organization', 'to org', 'transfer organization']
    },
    checks: function (built) {
        var s = frSheet(built, 'InvTransactionsInterface'), out = [];
        if (!s) return out;
        var H = frHelper(s), src = {}, lotNums = {};
        s.rows.forEach(function (row, r) {
            if (!H.v(row, 'ITEM_NUMBER') && !H.v(row, 'INVENTORY_ITEM')) out.push(frIssue(s.csv, r, H.idx('ITEM_NUMBER'), 'E', 'item', 'Give the ITEM_NUMBER'));
            if (H.v(row, 'TRANSACTION_QUANTITY') && H.n(row, 'TRANSACTION_QUANTITY') === 0) out.push(frIssue(s.csv, r, H.idx('TRANSACTION_QUANTITY'), 'E', 'qty', 'Quantity is zero'));
            var ty = H.v(row, 'TRANSACTION_TYPE_NAME');
            if (/issue/i.test(ty) && H.n(row, 'TRANSACTION_QUANTITY') > 0) out.push(frIssue(s.csv, r, H.idx('TRANSACTION_QUANTITY'), 'W', 'qty', 'Issues are usually entered with a negative quantity'));
            if (/transfer/i.test(ty) && !H.v(row, 'TRANSFER_SUBINVENTORY') && !H.v(row, 'TRANSFER_ORGANIZATION_NAME'))
                out.push(frIssue(s.csv, r, H.idx('TRANSFER_SUBINVENTORY'), 'E', 'transfer', 'A transfer needs TRANSFER_SUBINVENTORY or TRANSFER_ORGANIZATION_NAME'));
            var k = H.v(row, 'SOURCE_HEADER_ID') + '|' + H.v(row, 'SOURCE_LINE_ID');
            if (k !== '|') { if (src[k]) out.push(frIssue(s.csv, r, H.idx('SOURCE_LINE_ID'), 'E', 'dup', 'SOURCE_HEADER_ID + SOURCE_LINE_ID ' + k.replace('|', ' / ') + ' is used twice')); src[k] = 1; }
            if (H.v(row, 'INV_LOTSERIAL_INTERFACE_NUM')) lotNums[H.v(row, 'INV_LOTSERIAL_INTERFACE_NUM')] = 1;
        });
        var lots = frSheet(built, 'InvTransactionLotsInterface');
        if (lots) {
            var LH = frHelper(lots), ref = lots.spec.cols[0].n;
            lots.rows.forEach(function (row, r) {
                var v = LH.v(row, ref);
                if (v && !lotNums[v]) out.push(frIssue(lots.csv, r, 0, 'E', 'orphan', 'Lot row ' + v + ' matches no INV_LOTSERIAL_INTERFACE_NUM on the transactions sheet'));
            });
        }
        return out;
    },
    fusion: [
        { id: 'org', name: 'Organization exists', sev: 'E', csv: 'InvTransactionsInterface', key: function (H, r) { return H.v(r, 'ORGANIZATION_NAME') || null; },
          sql: function (IN) { return 'SELECT organization_name AS k FROM inv_organization_definitions_v WHERE organization_name IN (' + IN + ')'; }, missing: 'Organization "{v}" does not exist' },
        { id: 'item', name: 'Item assigned to the organization', sev: 'E', csv: 'InvTransactionsInterface',
          key: function (H, r) { var i = H.v(r, 'ITEM_NUMBER'); return i ? H.v(r, 'ORGANIZATION_NAME') + '|' + i : null; },
          inKey: function (H, r) { return H.v(r, 'ITEM_NUMBER') || null; },
          sql: function (IN) { return "SELECT d.organization_name || '|' || i.item_number AS k FROM egp_system_items_b i JOIN inv_organization_definitions_v d ON d.organization_id = i.organization_id WHERE i.item_number IN (" + IN + ')'; },
          missing: 'Item {v} is not assigned to that organization' },
        { id: 'subinv', name: 'Subinventory exists', sev: 'E', csv: 'InvTransactionsInterface',
          key: function (H, r) { var s = H.v(r, 'SUBINVENTORY_CODE'); return s ? H.v(r, 'ORGANIZATION_NAME') + '|' + s : null; },
          inKey: function (H, r) { return H.v(r, 'SUBINVENTORY_CODE') || null; },
          sql: function (IN) { return "SELECT d.organization_name || '|' || si.secondary_inventory_name AS k FROM inv_secondary_inventories si JOIN inv_organization_definitions_v d ON d.organization_id = si.organization_id WHERE si.secondary_inventory_name IN (" + IN + ')'; },
          missing: 'Subinventory {v} does not exist in that organization' },
        { id: 'type', name: 'Transaction type exists', sev: 'E', csv: 'InvTransactionsInterface', key: function (H, r) { return H.v(r, 'TRANSACTION_TYPE_NAME') || null; },
          sql: function (IN) { return 'SELECT transaction_type_name AS k FROM inv_transaction_types_vl WHERE transaction_type_name IN (' + IN + ')'; }, missing: 'Transaction type "{v}" does not exist' },
        { id: 'uom', name: 'Unit of measure exists', sev: 'E', csv: 'InvTransactionsInterface', key: function (H, r) { return H.v(r, 'TRANSACTION_UOM') || null; },
          sql: function (IN) { return 'SELECT uom_code AS k FROM inv_units_of_measure_vl WHERE uom_code IN (' + IN + ')'; }, missing: 'UOM code {v} does not exist' }
    ]
};

/** Custom live checks (need more than a lookup). Each returns a promise of issues. */
var FR_CUSTOM = {
    // Every accounting date must fall in an open (or future-enterable) GL period of its ledger.
    period: function (sheet, H, run) {
        var ledgers = {};
        sheet.rows.forEach(function (row) { var l = H.v(row, 'LEDGER_ID'); if (l) ledgers[l] = 1; });
        var list = Object.keys(ledgers);
        if (!list.length || !H.has('ACCOUNTING_DATE')) return Promise.resolve({ skipped: 'needs Ledger ID and accounting date' });
        var sql = "SELECT TO_CHAR(ledger_id) AS ledger, period_name, closing_status, TO_CHAR(start_date, 'YYYY/MM/DD') AS s, TO_CHAR(end_date, 'YYYY/MM/DD') AS e " +
            "FROM gl_period_statuses WHERE application_id = 101 AND NVL(adjustment_period_flag, 'N') = 'N' AND TO_CHAR(ledger_id) IN (" + list.map(frLit).join(',') + ')';
        return run(sql).then(function (rows) {
            var issues = [], by = {};
            rows.forEach(function (p) { (by[p.LEDGER] = by[p.LEDGER] || []).push(p); });
            sheet.rows.forEach(function (row, r) {
                var l = H.v(row, 'LEDGER_ID'), d = H.v(row, 'ACCOUNTING_DATE').slice(0, 10);
                if (!l || !/^\d{4}\/\d{2}\/\d{2}$/.test(d)) return;
                var p = (by[l] || []).filter(function (x) { return x.S <= d && d <= x.E; })[0];
                if (!p) issues.push({ r: r, c: H.idx('ACCOUNTING_DATE'), sev: 'E', msg: 'No GL period covers ' + d });
                else if (p.CLOSING_STATUS === 'F') issues.push({ r: r, c: H.idx('ACCOUNTING_DATE'), sev: 'W', msg: 'Period ' + p.PERIOD_NAME + ' is future-enterable (journals import but cannot post yet)' });
                else if (p.CLOSING_STATUS !== 'O') issues.push({ r: r, c: H.idx('ACCOUNTING_DATE'), sev: 'E', msg: 'Period ' + p.PERIOD_NAME + ' is not open (status ' + p.CLOSING_STATUS + ')' });
            });
            return { issues: issues, sql: sql };
        });
    },
    // Account combinations that do not exist yet (created on import only if dynamic insertion is on).
    ccid: function (sheet, H, run) {
        var n = 0;
        for (var i = 1; i <= 30; i++) if (H.has('SEGMENT' + i) && sheet.rows.some(function (row) { return H.v(row, 'SEGMENT' + i); })) n = i;
        if (!n) return Promise.resolve({ skipped: 'no segments mapped' });
        var seg = []; for (i = 1; i <= n; i++) seg.push('SEGMENT' + i);
        var keyOf = function (row) { return seg.map(function (c) { return H.v(row, c); }).join('.'); };
        var keys = {}; sheet.rows.forEach(function (row) { keys[keyOf(row)] = 1; });
        var expr = seg.map(function (c) { return 'NVL(' + c.toLowerCase() + ", '')"; }).join(" || '.' || ");
        return frChunks(Object.keys(keys), 400, function (part) {
            return "SELECT " + expr + " AS k FROM gl_code_combinations WHERE enabled_flag = 'Y' AND " + expr + ' IN (' + part.map(frLit).join(',') + ')';
        }, run).then(function (res) {
            var found = {}; res.rows.forEach(function (x) { found[x.K] = 1; });
            var issues = [];
            sheet.rows.forEach(function (row, r) {
                var k = keyOf(row);
                if (!found[k]) issues.push({ r: r, c: H.idx('SEGMENT1'), sev: 'W', msg: 'Account ' + k + ' does not exist yet (imports only if dynamic insertion is enabled)' });
            });
            return { issues: issues, sql: res.sql };
        });
    }
};

function frLit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
/** Run a keyed lookup in chunks (Oracle IN lists max 1000) → { rows, sql (first) }. */
function frChunks(keys, size, sqlOf, run) {
    var parts = [], all = [], first = null;
    for (var i = 0; i < keys.length; i += size) parts.push(keys.slice(i, i + size));
    return parts.reduce(function (p, part) {
        return p.then(function () { var sql = sqlOf(part); first = first || sql; return run(sql).then(function (rows) { all = all.concat(rows); }); });
    }, Promise.resolve()).then(function () { return { rows: all, sql: first }; });
}

/** Run every live Fusion check of a template. run(sql) → promise of rows (UPPER keys).
    onStep(check, state) reports progress. Resolves [{ id, name, sev, status: pass|fail|skip|error, count, sql, error, issues }] */
function frRunFusion(template, built, run, onStep) {
    var R = FBDI_RULES[template]; if (!R || !R.fusion) return Promise.resolve([]);
    var results = [];
    return R.fusion.reduce(function (p, chk) {
        return p.then(function () {
            var sheet = frSheet(built, chk.csv);
            var res = { id: chk.id, name: chk.name, sev: chk.sev, csv: chk.csv, status: 'skip', count: 0, issues: [] };
            results.push(res);
            if (!sheet || !sheet.rows.length) { res.note = 'sheet not included'; return; }
            var H = frHelper(sheet);
            if (onStep) onStep(chk, 'running');
            var job;
            if (chk.custom) job = FR_CUSTOM[chk.custom](sheet, H, run);
            else {
                var keyed = {}, inVals = {};
                sheet.rows.forEach(function (row, r) {
                    var k = chk.key(H, row); if (k == null || k === '' || k === '#NULL') return;
                    (keyed[k] = keyed[k] || []).push(r);
                    var iv = chk.inKey ? chk.inKey(H, row) : k; if (iv) inVals[iv] = 1;
                });
                var vals = Object.keys(inVals);
                if (!vals.length) { res.note = 'no values to check'; if (onStep) onStep(chk, 'skip'); return; }
                job = frChunks(vals, 400, function (part) { return chk.sql(part.map(frLit).join(',')); }, run).then(function (x) {
                    var found = {}; x.rows.forEach(function (row) { found[String(row.K)] = 1; });
                    var issues = [];
                    Object.keys(keyed).forEach(function (k) {
                        var bad = chk.present ? found[k] : !found[k];
                        if (!bad) return;
                        var shown = k.indexOf('|') >= 0 ? k.split('|').pop() : k;
                        keyed[k].forEach(function (r) {
                            issues.push({ r: r, c: -1, sev: chk.sev, msg: (chk.present || chk.missing).replace('{v}', shown) });
                        });
                    });
                    return { issues: issues, sql: x.sql, checked: vals.length };
                });
            }
            return job.then(function (x) {
                if (x.skipped) { res.status = 'skip'; res.note = x.skipped; if (onStep) onStep(chk, 'skip'); return; }
                res.sql = x.sql; res.checked = x.checked;
                res.issues = x.issues.map(function (i) { return frIssue(chk.csv, i.r, i.c, i.sev || chk.sev, 'fusion:' + chk.id, i.msg); });
                res.count = res.issues.length;
                res.status = res.count ? 'fail' : 'pass';
                if (onStep) onStep(chk, res.status);
            }, function (e) {
                res.status = 'error'; res.error = String(e && e.message || e);
                if (onStep) onStep(chk, 'error');
            });
        });
    }, Promise.resolve()).then(function () { return results; });
}

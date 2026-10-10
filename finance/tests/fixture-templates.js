/* Test fixture only (not shipped): statement templates on the account ranges of tests/fixture-gl.json
   (1xxx assets … 8xxx tax, 9999 suspense) — the app builds its statements from the Fusion account classes (FINE.autoTemplates). */
'use strict';
var B = { bold: true }, T = { bold: true, topBorder: true }, TT = { bold: true, topBorder: true, doubleBottom: true }, I = { italic: true, muted: true };
    var MGMT_COLS = [
    { id: 'm_act', scenario: 'ACTUAL', range: 'MTD' }, { id: 'm_bud', scenario: 'BUDGET', range: 'MTD' },
    { id: 'm_var', kind: 'var', a: 'm_act', b: 'm_bud', label: 'Var F/(U)' }, { id: 'm_varp', kind: 'var', a: 'm_act', b: 'm_bud', mode: 'pct', label: 'Var %' },
    { id: 'y_act', scenario: 'ACTUAL', range: 'YTD' }, { id: 'y_bud', scenario: 'BUDGET', range: 'YTD' },
    { id: 'y_var', kind: 'var', a: 'y_act', b: 'y_bud', label: 'Var F/(U)' }, { id: 'y_varp', kind: 'var', a: 'y_act', b: 'y_bud', mode: 'pct', label: 'Var %' },
    { id: 'y_py', scenario: 'ACTUAL', range: 'YTD', at: 'PY' }, { id: 'y_pyp', kind: 'var', a: 'y_act', b: 'y_py', mode: 'pct', label: 'vs PY %' }
];

var PL = {
    id: 'PL', name: 'Income statement — management', type: 'PL', scale: 1000, columns: MGMT_COLS,
    description: 'Month and year to date against budget and last year, by nature of expense, with margins.',
    rows: [
        { id: 'H_REV', type: 'header', label: 'Revenue', style: B },
        { id: 'S_BEV', type: 'accounts', label: 'Beverages', accounts: '4000', parent: 'GROSS', level: 1 },
        { id: 'S_SNK', type: 'accounts', label: 'Snacks', accounts: '4010', parent: 'GROSS', level: 1 },
        { id: 'S_HH', type: 'accounts', label: 'Household', accounts: '4020', parent: 'GROSS', level: 1 },
        { id: 'GROSS', type: 'group', label: 'Gross sales', parent: 'REV', level: 1, style: { bold: true } },
        { id: 'RET', type: 'accounts', label: 'Returns & discounts', accounts: '4100', sign: 'credit', parent: 'REV', level: 1 },
        { id: 'REV', type: 'group', label: 'Net revenue', style: T },
        { id: 'B1', type: 'blank' },
        { id: 'H_COS', type: 'header', label: 'Cost of sales', style: B },
        { id: 'C_GOODS', type: 'accounts', label: 'Cost of goods sold', accounts: '5000', parent: 'COGS', level: 1, favourable: 'down' },
        { id: 'C_FRT', type: 'accounts', label: 'Freight inwards', accounts: '5100', parent: 'COGS', level: 1, favourable: 'down' },
        { id: 'C_WO', type: 'accounts', label: 'Inventory write-offs', accounts: '5200', parent: 'COGS', level: 1, favourable: 'down' },
        { id: 'COGS', type: 'group', label: 'Total cost of sales', style: T, favourable: 'down' },
        { id: 'GP', type: 'formula', label: 'Gross profit', formula: 'REV - COGS', style: TT },
        { id: 'GM', type: 'formula', label: 'Gross margin', formula: 'PCT(GP, REV)', format: 'pct', style: I },
        { id: 'B2', type: 'blank' },
        { id: 'H_OPEX', type: 'header', label: 'Operating expenses', style: B },
        { id: 'STAFF', type: 'accounts', label: 'Staff costs', accounts: '6000-6010', parent: 'OPEX', level: 1, favourable: 'down' },
        { id: 'PREM', type: 'accounts', label: 'Premises & maintenance', accounts: '6100,6110,6600', parent: 'OPEX', level: 1, favourable: 'down' },
        { id: 'DIST', type: 'accounts', label: 'Distribution', accounts: '6200-6210', parent: 'OPEX', level: 1, favourable: 'down' },
        { id: 'SELL', type: 'accounts', label: 'Selling & marketing', accounts: '6300,6800', parent: 'OPEX', level: 1, favourable: 'down' },
        { id: 'ADMIN', type: 'accounts', label: 'Administration', accounts: '6400,6500,6700', parent: 'OPEX', level: 1, favourable: 'down' },
        { id: 'OPEX', type: 'group', label: 'Total operating expenses', style: T, favourable: 'down' },
        { id: 'OI', type: 'accounts', label: 'Other income', accounts: '4200' },
        { id: 'EBITDA', type: 'formula', label: 'EBITDA', formula: 'GP - OPEX + OI', style: TT },
        { id: 'EBITDAM', type: 'formula', label: 'EBITDA margin', formula: 'PCT(EBITDA, REV)', format: 'pct', style: I },
        { id: 'DA', type: 'accounts', label: 'Depreciation & amortisation', accounts: '6900-6950', favourable: 'down' },
        { id: 'EBIT', type: 'formula', label: 'Operating profit (EBIT)', formula: 'EBITDA - DA', style: T },
        { id: 'FIN', type: 'accounts', label: 'Finance costs', accounts: '7000-7200', favourable: 'down' },
        { id: 'PBT', type: 'formula', label: 'Profit before tax', formula: 'EBIT - FIN', style: T },
        { id: 'TAX', type: 'accounts', label: 'Income tax', accounts: '8000', favourable: 'down' },
        { id: 'NP', type: 'formula', label: 'Net profit', formula: 'PBT - TAX', style: TT },
        { id: 'NPM', type: 'formula', label: 'Net margin', formula: 'PCT(NP, REV)', format: 'pct', style: I }
    ]
};

var PLS = {
    id: 'PLS', name: 'Income statement — statutory (by function)', type: 'PL', scale: 1000,
    description: 'IAS 1 presentation by function: this year to date against last year.',
    columns: [{ id: 'cy', scenario: 'ACTUAL', range: 'YTD' }, { id: 'py', scenario: 'ACTUAL', range: 'YTD', at: 'PY' },
        { id: 'ch', kind: 'var', a: 'cy', b: 'py', label: 'Change' }, { id: 'chp', kind: 'var', a: 'cy', b: 'py', mode: 'pct', label: 'Change %' }],
    rows: [
        { id: 'REV', type: 'accounts', label: 'Revenue', accounts: '4000-4100', sign: 'credit', style: B },
        { id: 'COS', type: 'accounts', label: 'Cost of sales', accounts: '5000-5299', favourable: 'down' },
        { id: 'GP', type: 'formula', label: 'Gross profit', formula: 'REV - COS', style: T },
        { id: 'OI', type: 'accounts', label: 'Other income', accounts: '4200' },
        { id: 'DIST', type: 'accounts', label: 'Distribution and selling costs', accounts: '6200,6210,6300,6800', favourable: 'down' },
        { id: 'ADM', type: 'accounts', label: 'Administrative expenses', accounts: '6000-6110,6400-6700,6900-6950', favourable: 'down' },
        { id: 'OP', type: 'formula', label: 'Operating profit', formula: 'GP + OI - DIST - ADM', style: T },
        { id: 'FIN', type: 'accounts', label: 'Finance costs', accounts: '7000-7299', favourable: 'down' },
        { id: 'PBT', type: 'formula', label: 'Profit before tax', formula: 'OP - FIN', style: T },
        { id: 'TAX', type: 'accounts', label: 'Income tax expense', accounts: '8000-8999', favourable: 'down' },
        { id: 'NP', type: 'formula', label: 'Profit for the period', formula: 'PBT - TAX', style: TT },
        { id: 'B1', type: 'blank' },
        { id: 'EPS_NOTE', type: 'text', label: 'Earnings per share and other comprehensive income are not part of the general ledger view.', style: I }
    ]
};

var BS = {
    id: 'BS', name: 'Statement of financial position', type: 'BS', scale: 1000,
    description: 'Balance sheet at the period end against last month and the last year end, with a balance check.',
    columns: [{ id: 'cur', scenario: 'ACTUAL', range: 'BAL' }, { id: 'pm', scenario: 'ACTUAL', range: 'BAL', at: 'PM' },
        { id: 'pye', scenario: 'ACTUAL', range: 'BAL', at: 'PYE' }, { id: 'ch', kind: 'var', a: 'cur', b: 'pye', label: 'Change vs YE' }],
    rows: [
        { id: 'H_A', type: 'header', label: 'ASSETS', style: B },
        { id: 'H_NCA', type: 'header', label: 'Non-current assets', style: { italic: true, bold: true }, level: 0 },
        { id: 'PPE', type: 'accounts', label: 'Property, plant & equipment', accounts: '1600,1650', parent: 'NCA', level: 1 },
        { id: 'ROU', type: 'accounts', label: 'Right-of-use assets', accounts: '1700', parent: 'NCA', level: 1 },
        { id: 'INT', type: 'accounts', label: 'Intangible assets', accounts: '1800', parent: 'NCA', level: 1 },
        { id: 'NCA', type: 'group', label: 'Total non-current assets', parent: 'TA', style: T },
        { id: 'H_CA', type: 'header', label: 'Current assets', style: { italic: true, bold: true } },
        { id: 'INV', type: 'accounts', label: 'Inventories', accounts: '1200-1299', parent: 'CA', level: 1 },
        { id: 'AR', type: 'accounts', label: 'Trade receivables (net)', accounts: '1100,1150', parent: 'CA', level: 1 },
        { id: 'OCA', type: 'accounts', label: 'Prepayments & other receivables', accounts: '1300-1599', parent: 'CA', level: 1 },
        { id: 'SUSP', type: 'accounts', label: 'Suspense / unallocated', accounts: '9999', parent: 'CA', level: 1, note: 'Should be nil at month end' },
        { id: 'CASH', type: 'accounts', label: 'Cash and cash equivalents', accounts: '1000-1099', parent: 'CA', level: 1 },
        { id: 'CA', type: 'group', label: 'Total current assets', parent: 'TA', style: T },
        { id: 'TA', type: 'group', label: 'TOTAL ASSETS', style: TT },
        { id: 'B1', type: 'blank' },
        { id: 'H_EL', type: 'header', label: 'EQUITY AND LIABILITIES', style: B },
        { id: 'SC', type: 'accounts', label: 'Share capital', accounts: '3000', parent: 'EQ', level: 1 },
        { id: 'RE', type: 'accounts', label: 'Retained earnings', accounts: '3100', parent: 'EQ', level: 1 },
        { id: 'CYE', type: 'accounts', label: 'Profit for the year to date', accounts: '4000-8999', basis: 'balance', sign: 'credit', parent: 'EQ', level: 1 },
        { id: 'EQ', type: 'group', label: 'Total equity', parent: 'TEL', style: T },
        { id: 'H_NCL', type: 'header', label: 'Non-current liabilities', style: { italic: true, bold: true } },
        { id: 'LOANS', type: 'accounts', label: 'Long-term loans', accounts: '2700', parent: 'NCL', level: 1 },
        { id: 'LEASE', type: 'accounts', label: 'Lease liabilities', accounts: '2800', parent: 'NCL', level: 1 },
        { id: 'NCL', type: 'group', label: 'Total non-current liabilities', parent: 'TL', style: T },
        { id: 'H_CL', type: 'header', label: 'Current liabilities', style: { italic: true, bold: true } },
        { id: 'AP', type: 'accounts', label: 'Trade payables', accounts: '2000', parent: 'CL', level: 1 },
        { id: 'ACCR', type: 'accounts', label: 'Accruals & payroll', accounts: '2100,2300', parent: 'CL', level: 1 },
        { id: 'TAXL', type: 'accounts', label: 'VAT and income tax', accounts: '2200,2400', parent: 'CL', level: 1 },
        { id: 'ICP', type: 'accounts', label: 'Intercompany payables', accounts: '2500', parent: 'CL', level: 1 },
        { id: 'STB', type: 'accounts', label: 'Short-term borrowings', accounts: '2600', parent: 'CL', level: 1 },
        { id: 'CL', type: 'group', label: 'Total current liabilities', parent: 'TL', style: T },
        { id: 'TL', type: 'group', label: 'Total liabilities', parent: 'TEL', style: T },
        { id: 'TEL', type: 'group', label: 'TOTAL EQUITY AND LIABILITIES', style: TT },
        { id: 'CHK', type: 'check', label: 'Check: assets − equity and liabilities', formula: 'TA - TEL', style: I }
    ]
};

var CF = {
    id: 'CF', name: 'Statement of cash flows — indirect', type: 'CF', scale: 1000,
    description: 'Built from the balance sheet movements: profit, non-cash items, working capital, investing and financing — ties to the bank balance.',
    columns: [{ id: 'm', scenario: 'ACTUAL', range: 'MTD' }, { id: 'q', scenario: 'ACTUAL', range: 'QTD' }, { id: 'y', scenario: 'ACTUAL', range: 'YTD' }, { id: 'l', scenario: 'ACTUAL', range: 'LTM' }],
    rows: [
        { id: 'H_OP', type: 'header', label: 'Cash flows from operating activities', style: B },
        { id: 'NP', type: 'accounts', label: 'Profit for the period', accounts: '4000-8999', basis: 'activity', sign: 'credit', parent: 'OPC', level: 1 },
        { id: 'DA', type: 'accounts', label: 'Depreciation & amortisation (non-cash)', accounts: '1650,1700,1800', basis: 'change', sign: 'credit', parent: 'OPC', level: 1 },
        { id: 'WC_AR', type: 'accounts', label: '(Increase) / decrease in receivables', accounts: '1100,1150', basis: 'change', sign: 'credit', parent: 'OPC', level: 1 },
        { id: 'WC_INV', type: 'accounts', label: '(Increase) / decrease in inventories', accounts: '1200-1299', basis: 'change', sign: 'credit', parent: 'OPC', level: 1 },
        { id: 'WC_OTH', type: 'accounts', label: '(Increase) / decrease in other receivables', accounts: '1300-1599,9999', basis: 'change', sign: 'credit', parent: 'OPC', level: 1 },
        { id: 'WC_AP', type: 'accounts', label: 'Increase / (decrease) in trade payables', accounts: '2000', basis: 'change', sign: 'credit', parent: 'OPC', level: 1 },
        { id: 'WC_ACC', type: 'accounts', label: 'Increase / (decrease) in accruals, taxes & other payables', accounts: '2100-2599', basis: 'change', sign: 'credit', parent: 'OPC', level: 1 },
        { id: 'OPC', type: 'group', label: 'Net cash from operating activities', style: T },
        { id: 'B1', type: 'blank' },
        { id: 'H_INV', type: 'header', label: 'Cash flows from investing activities', style: B },
        { id: 'CAPEX', type: 'accounts', label: 'Purchase of property, plant & equipment', accounts: '1600', basis: 'change', sign: 'credit', parent: 'INVC', level: 1 },
        { id: 'INVC', type: 'group', label: 'Net cash used in investing activities', style: T },
        { id: 'B2', type: 'blank' },
        { id: 'H_FIN', type: 'header', label: 'Cash flows from financing activities', style: B },
        { id: 'BORR', type: 'accounts', label: 'Borrowings drawn / (repaid)', accounts: '2600,2700', basis: 'change', sign: 'credit', parent: 'FINC', level: 1 },
        { id: 'LEASEP', type: 'accounts', label: 'Lease payments', accounts: '2800', basis: 'change', sign: 'credit', parent: 'FINC', level: 1 },
        { id: 'EQT', type: 'accounts', label: 'Share capital issued', accounts: '3000', basis: 'change', sign: 'credit', parent: 'FINC', level: 1 },
        { id: 'FINC', type: 'group', label: 'Net cash from financing activities', style: T },
        { id: 'B3', type: 'blank' },
        { id: 'NET', type: 'formula', label: 'Net increase / (decrease) in cash', formula: 'OPC + INVC + FINC', style: T },
        { id: 'OPEN', type: 'accounts', label: 'Cash at the beginning of the period', accounts: '1000-1099', basis: 'opening', sign: 'debit' },
        { id: 'CLOSE', type: 'formula', label: 'Cash at the end of the period', formula: 'OPEN + NET', style: TT },
        { id: 'BOOK', type: 'accounts', label: 'Cash per balance sheet', accounts: '1000-1099', basis: 'balance', sign: 'debit', style: I },
        { id: 'CHK', type: 'check', label: 'Check: cash flow ties to the bank balance', formula: 'CLOSE - BOOK', style: I },
        { id: 'B4', type: 'blank' },
        { id: 'FCF', type: 'formula', label: 'Free cash flow (operating + investing)', formula: 'OPC + INVC', style: B }
    ]
};


module.exports = [PL, PLS, BS, CF];

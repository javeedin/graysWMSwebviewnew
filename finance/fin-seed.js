/* Finance Lens — starter templates, KPI library and monitor rules. Saved to templates.json / config.json on first use and then
   edited in the Designer; account ranges match the sample chart of accounts (1xxx assets … 8xxx tax, 9999 suspense) —
   change them to your Fusion account segment in Setup › Templates. */
(function (root) {
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

    var KPIS = [
        // profitability
        { id: 'rev', group: 'Profitability', label: 'Net revenue YTD', expr: 'PL.REV@YTD', fmt: 'money', good: 'up', desc: 'Sales less returns and discounts, year to date.' },
        { id: 'rev_g', group: 'Profitability', label: 'Revenue growth vs PY', expr: 'PCT(PL.REV@YTD - PL.REV@PYYTD, PL.REV@PYYTD)', fmt: 'pct', good: 'up', desc: 'Year to date against the same months last year.' },
        { id: 'gm', group: 'Profitability', label: 'Gross margin', expr: 'PCT(PL.GP, PL.REV)', fmt: 'pct', good: 'up', desc: 'Gross profit as % of net revenue (YTD).' },
        { id: 'ebitda', group: 'Profitability', label: 'EBITDA YTD', expr: 'PL.EBITDA@YTD', fmt: 'money', good: 'up', desc: 'Earnings before interest, tax, depreciation and amortisation.' },
        { id: 'ebitda_m', group: 'Profitability', label: 'EBITDA margin', expr: 'PCT(PL.EBITDA, PL.REV)', fmt: 'pct', good: 'up' },
        { id: 'np', group: 'Profitability', label: 'Net profit YTD', expr: 'PL.NP@YTD', fmt: 'money', good: 'up' },
        { id: 'npm', group: 'Profitability', label: 'Net margin', expr: 'PCT(PL.NP, PL.REV)', fmt: 'pct', good: 'up' },
        { id: 'np_m', group: 'Profitability', label: 'Net profit this month', expr: 'PL.NP@MTD', fmt: 'money', good: 'up' },
        // cost control
        { id: 'opex_r', group: 'Cost control', label: 'Opex to revenue', expr: 'PCT(PL.OPEX, PL.REV)', fmt: 'pct', good: 'down' },
        { id: 'staff_r', group: 'Cost control', label: 'Staff cost to revenue', expr: 'PCT(PL.STAFF, PL.REV)', fmt: 'pct', good: 'down' },
        { id: 'dist_r', group: 'Cost control', label: 'Distribution cost to revenue', expr: 'PCT(PL.DIST, PL.REV)', fmt: 'pct', good: 'down' },
        { id: 'cogs_r', group: 'Cost control', label: 'Cost of sales to revenue', expr: 'PCT(PL.COGS, PL.REV)', fmt: 'pct', good: 'down' },
        // budget
        { id: 'rev_bud', group: 'Budget', label: 'Revenue vs budget', expr: 'PCT(PL.REV@YTD, PL.REV@BUDYTD)', fmt: 'pct', good: 'up', desc: '100 % = on budget.' },
        { id: 'opex_bud', group: 'Budget', label: 'Opex vs budget', expr: 'PCT(PL.OPEX@YTD, PL.OPEX@BUDYTD)', fmt: 'pct', good: 'down' },
        { id: 'np_bud', group: 'Budget', label: 'Net profit vs budget', expr: 'PCT(PL.NP@YTD, PL.NP@BUDYTD)', fmt: 'pct', good: 'up' },
        { id: 'fy_burn', group: 'Budget', label: 'Full-year opex budget used', expr: 'PCT(PL.OPEX@YTD, PL.OPEX@BUDFY)', fmt: 'pct', good: 'down' },
        // liquidity
        { id: 'cash', group: 'Liquidity', label: 'Cash', expr: 'BS.CASH@BAL', fmt: 'money', good: 'up' },
        { id: 'cr', group: 'Liquidity', label: 'Current ratio', expr: 'DIV(BS.CA@BAL, BS.CL@BAL)', fmt: 'ratio', good: 'up', desc: 'Current assets ÷ current liabilities.' },
        { id: 'qr', group: 'Liquidity', label: 'Quick ratio', expr: 'DIV(BS.CA@BAL - BS.INV@BAL, BS.CL@BAL)', fmt: 'ratio', good: 'up', desc: 'Without inventories.' },
        { id: 'wc', group: 'Liquidity', label: 'Working capital', expr: 'BS.CA@BAL - BS.CL@BAL', fmt: 'money', good: 'up' },
        { id: 'netdebt', group: 'Liquidity', label: 'Net debt', expr: 'BS.STB@BAL + BS.LOANS@BAL + BS.LEASE@BAL - BS.CASH@BAL', fmt: 'money', good: 'down' },
        // efficiency
        { id: 'dso', group: 'Efficiency', label: 'Days sales outstanding', expr: 'DIV(BS.AR@BAL, PL.REV@LTM * 1.15) * 365', fmt: 'days', good: 'down', desc: 'Receivables (incl. 15 % VAT) ÷ last 12 months revenue × 365.' },
        { id: 'dio', group: 'Efficiency', label: 'Days inventory outstanding', expr: 'DIV(BS.INV@BAL, PL.COGS@LTM) * 365', fmt: 'days', good: 'down' },
        { id: 'dpo', group: 'Efficiency', label: 'Days payables outstanding', expr: 'DIV(BS.AP@BAL, PL.COGS@LTM * 1.15) * 365', fmt: 'days', good: 'up' },
        { id: 'ccc', group: 'Efficiency', label: 'Cash conversion cycle', expr: 'dso + dio - dpo', fmt: 'days', good: 'down', desc: 'Days of cash tied up in the operating cycle.' },
        { id: 'at', group: 'Efficiency', label: 'Asset turnover', expr: 'DIV(PL.REV@LTM, BS.TA@BAL)', fmt: 'ratio', good: 'up' },
        // returns & leverage
        { id: 'roe', group: 'Returns & leverage', label: 'Return on equity', expr: 'PCT(PL.NP@LTM, BS.EQ@BAL)', fmt: 'pct', good: 'up' },
        { id: 'roa', group: 'Returns & leverage', label: 'Return on assets', expr: 'PCT(PL.NP@LTM, BS.TA@BAL)', fmt: 'pct', good: 'up' },
        { id: 'roce', group: 'Returns & leverage', label: 'Return on capital employed', expr: 'PCT(PL.EBIT@LTM, BS.TA@BAL - BS.CL@BAL)', fmt: 'pct', good: 'up' },
        { id: 'de', group: 'Returns & leverage', label: 'Debt to equity', expr: 'DIV(BS.STB@BAL + BS.LOANS@BAL + BS.LEASE@BAL, BS.EQ@BAL)', fmt: 'ratio', good: 'down' },
        { id: 'nd_ebitda', group: 'Returns & leverage', label: 'Net debt / EBITDA', expr: 'DIV(netdebt, PL.EBITDA@LTM)', fmt: 'ratio', good: 'down' },
        { id: 'icr', group: 'Returns & leverage', label: 'Interest cover', expr: 'DIV(PL.EBIT@LTM, PL.FIN@LTM)', fmt: 'ratio', good: 'up', desc: 'EBIT ÷ finance costs (last 12 months).' },
        // cash
        { id: 'ocf', group: 'Cash flow', label: 'Operating cash flow YTD', expr: 'CF.OPC@YTD', fmt: 'money', good: 'up' },
        { id: 'fcf', group: 'Cash flow', label: 'Free cash flow YTD', expr: 'CF.FCF@YTD', fmt: 'money', good: 'up' },
        { id: 'cconv', group: 'Cash flow', label: 'Cash conversion (OCF / EBITDA)', expr: 'PCT(CF.OPC@LTM, PL.EBITDA@LTM)', fmt: 'pct', good: 'up' },
        // control
        { id: 'susp', group: 'Control', label: 'Suspense balance', expr: 'BS.SUSP@BAL', fmt: 'money', good: 'down' },
        { id: 'bs_chk', group: 'Control', label: 'Balance sheet difference', expr: 'BS.CHK@BAL', fmt: 'money', good: 'down' }
    ];
    var HEADLINE = ['rev', 'gm', 'ebitda', 'np', 'cash', 'cr', 'dso', 'ccc', 'rev_bud', 'roe', 'nd_ebitda', 'ocf'];

    var MONITORS = [
        { id: 'm1', kpi: 'cr', op: '<', value: 1.2, severity: 'high', label: 'Current ratio below 1.2' },
        { id: 'm2', kpi: 'qr', op: '<', value: 0.8, severity: 'medium', label: 'Quick ratio below 0.8' },
        { id: 'm3', kpi: 'dso', op: '>', value: 50, severity: 'medium', label: 'Customers pay slower than 50 days' },
        { id: 'm4', kpi: 'gm', op: '<', value: 38, severity: 'high', label: 'Gross margin below 38 %' },
        { id: 'm5', kpi: 'npm', op: '<', value: 6, severity: 'medium', label: 'Net margin below 6 %' },
        { id: 'm6', kpi: 'rev_bud', op: '<', value: 97, severity: 'medium', label: 'Revenue more than 3 % behind budget' },
        { id: 'm7', kpi: 'opex_bud', op: '>', value: 103, severity: 'medium', label: 'Opex more than 3 % over budget' },
        { id: 'm8', kpi: 'nd_ebitda', op: '>', value: 2.5, severity: 'high', label: 'Net debt above 2.5× EBITDA (covenant)' },
        { id: 'm9', kpi: 'icr', op: '<', value: 4, severity: 'high', label: 'Interest cover below 4× (covenant)' },
        { id: 'm10', kpi: 'susp', op: '<>', value: 0, severity: 'critical', label: 'Suspense account not cleared' },
        { id: 'm11', kpi: 'bs_chk', op: '<>', value: 0, severity: 'critical', label: 'Balance sheet does not balance' },
        { id: 'm12', kpi: 'cash', op: '<', value: 10000000, severity: 'high', label: 'Cash below 10 million' }
    ];

    root.FIN_SEED = {
        version: 1,
        templates: [PL, PLS, BS, CF],
        config: {
            kpis: KPIS, headline: HEADLINE, monitors: MONITORS,
            pack: { title: 'Monthly board pack', company: 'Grays Group', sections: ['summary', 'kpis', 'PL', 'BS', 'CF', 'bridge', 'costcentres', 'monitor', 'risk'], keyRows: ['REV', 'GP', 'OPEX', 'EBITDA', 'NP'] },
            journalRisk: { manualSources: ['Manual', 'Spreadsheet'], bigManual: 1000000, roundTo: 10000, afterHour: 20, beforeHour: 7 }
        }
    };
})(typeof window !== 'undefined' ? window : this);

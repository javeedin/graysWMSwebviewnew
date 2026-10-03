/* Finance Lens — starter statements, KPI library and monitor rules. The statements are built from the account classes of the
   Fusion chart of accounts (FINE.autoTemplates — every account gets a class from its type and name, Data › Account mapping
   changes it); saved to templates.json / config.json on first use and then edited in the Designer. */
(function (root) {
    'use strict';

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
        templates: root.FINE ? root.FINE.autoTemplates() : [],
        config: {
            kpis: KPIS, headline: HEADLINE, monitors: MONITORS,
            pack: { title: 'Monthly board pack', company: 'Grays Group', sections: ['summary', 'kpis', 'PL', 'BS', 'CF', 'bridge', 'costcentres', 'monitor', 'risk'], keyRows: ['REV', 'GP', 'OPEX', 'EBITDA', 'NP'] },
            journalRisk: { manualSources: ['Manual', 'Spreadsheet'], bigManual: 1000000, roundTo: 10000, afterHour: 20, beforeHour: 7 }
        }
    };
})(typeof window !== 'undefined' ? window : this);

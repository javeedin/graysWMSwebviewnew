/* Fusion Setup & Diagnostics — page entry: the views of this module (see setup-*.js for each one). */
FX.start({
    module: 'setup',
    sub: 'Business units, setup data, coverage, UAT diagnostics and reference guides',
    views: [
        { id: 'bu', label: 'Business Units', icon: 'fa-building', group: 'Enterprise', desc: 'Financials business units (finBusinessUnitsLOV) — every row.', render: SetEnt.renderBU },
        { id: 'le', label: 'Legal Entities', icon: 'fa-landmark', group: 'Enterprise', desc: 'Legal entities (legalEntitiesLOV) — every row.', render: SetEnt.renderLE },
        { id: 'browse', label: 'Browse Data', icon: 'fa-satellite-dish', group: 'Data', desc: 'Count records per service, find the business units with data, run any GET.', render: SetBrowse.render },
        { id: 'po360', label: '360° PO Tracker', icon: 'fa-magnifying-glass-chart', group: 'Data', desc: 'One PO: header, child collections, receipts and variance.', render: SetPo.render },
        { id: 'setupdata', label: 'Setup Data Explorer', icon: 'fa-file-zipper', group: 'Data', desc: 'Analyse an FSM Setup Data Export ZIP — configured tasks and BU coverage.', render: function (el) { SetExp.render(el); } },
        { id: 'coa', label: 'COA Segments', icon: 'fa-sitemap', group: 'Data', desc: 'Chart-of-accounts value sets and their values.', render: SetCoa.render },
        { id: 'tb', label: 'Trial Balance Check', icon: 'fa-scale-balanced', group: 'Data', desc: 'Load a trial balance Excel, filter, total and validate its segments.', render: SetTb.render },
        { id: 'uat', label: 'UAT Diagnostics', icon: 'fa-stethoscope', group: 'Diagnostics', desc: 'BI Publisher diagnostic reports with drill-down.', render: SetBip.render },
        { id: 'logins', label: 'Login History', icon: 'fa-user-clock', group: 'Diagnostics', desc: 'Identity-domain sign-in audit.', render: SetGuide.login },
        { id: 'arch', label: 'Fusion Architecture', icon: 'fa-diagram-project', group: 'Guides', desc: 'From sign-in to fully transactional operations across modules.', render: SetGuide.architecture },
        { id: 'parallel', label: 'Parallel Run Strategy', icon: 'fa-code-compare', group: 'Guides', desc: 'Automated, reconciled, evidence-driven path to go-live.', render: SetGuide.parallel }
    ]
});

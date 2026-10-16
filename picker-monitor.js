// ============================================================================
// PICKER MONITOR — Real-time Picking Status Monitor
// ============================================================================
console.log('[PickerMonitor] Loading...');

(function () {

    // ── Inject scoped CSS ────────────────────────────────────────────────────
    const CSS = `
    /* ── Picker Monitor Layout ─────────────────────── */
    #picker-management {
        display: flex;
        flex-direction: column;
        height: 100%;
    }
    .pm-layout {
        display: flex;
        gap: 0;
        flex: 1;
        min-height: 0;
    }

    /* ── Right filter panel ────────────────────────── */
    .pm-filter-panel {
        width: 280px;
        min-width: 260px;
        background: white;
        border-left: 1px solid #e2e8f0;
        display: flex;
        flex-direction: column;
        gap: 0;
        overflow-y: auto;
        padding: 0;
        flex-shrink: 0;
        order: 2;
    }
    .pm-panel-section {
        padding: 1rem 1.1rem;
        border-bottom: 1px solid #f1f5f9;
    }
    .pm-panel-section-title {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #94a3b8;
        margin-bottom: 0.6rem;
    }

    /* ── Main content ──────────────────────────────── */
    .pm-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding: 1rem 1.25rem;
        order: 1;
    }

    /* ── Summary stat row ──────────────────────────── */
    .pm-summary-row {
        display: flex;
        gap: 0.65rem;
        flex-wrap: wrap;
        margin-bottom: 1rem;
    }
    .pm-stat-card {
        background: white;
        border-radius: 10px;
        padding: 0.65rem 0.9rem;
        min-width: 95px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.07);
        border-left: 4px solid #e2e8f0;
        flex: 1;
    }
    .pm-stat-val {
        font-size: 1.4rem;
        font-weight: 800;
        color: #1e293b;
        line-height: 1;
    }
    .pm-stat-lbl {
        font-size: 0.68rem;
        color: #64748b;
        font-weight: 600;
        margin-top: 0.25rem;
        white-space: nowrap;
    }

    /* ── View mode tab bar ─────────────────────────── */
    .pm-view-bar {
        display: flex;
        gap: 0.4rem;
        margin-bottom: 1rem;
        background: white;
        padding: 0.4rem;
        border-radius: 10px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.07);
    }
    .pm-view-btn {
        flex: 1;
        padding: 0.5rem 0.75rem;
        border: none;
        border-radius: 7px;
        font-size: 0.78rem;
        font-weight: 600;
        cursor: pointer;
        background: transparent;
        color: #64748b;
        transition: all 0.18s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
    }
    .pm-view-btn:hover   { background: #f1f5f9; color: #1e293b; }
    .pm-view-btn.active  {
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: white;
        box-shadow: 0 2px 8px rgba(99,102,241,0.35);
    }

    /* ── Group block ───────────────────────────────── */
    .pm-group-block {
        background: white;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.07);
        margin-bottom: 1.1rem;
        overflow: hidden;
        border: 1px solid #e2e8f0;
    }
    .pm-group-header {
        padding: 0.85rem 1rem;
        border-bottom: 1px solid #f1f5f9;
        background: linear-gradient(to right, #f8fafc, #ffffff);
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    /* ── Badge row ─────────────────────────────────── */
    .pm-badge {
        padding: 0.2rem 0.55rem;
        border-radius: 20px;
        font-size: 0.68rem;
        font-weight: 700;
        white-space: nowrap;
    }
    .pm-badge-total   { background:#e0e7ff; color:#3730a3; }
    .pm-badge-picked  { background:#d1fae5; color:#065f46; }
    .pm-badge-inprog  { background:#fef3c7; color:#92400e; }
    .pm-badge-pending { background:#fee2e2; color:#991b1b; }
    .pm-badge-cancel  { background:#f1f5f9; color:#475569; }

    /* ── Order cards grid ──────────────────────────── */
    .pm-orders-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(195px, 1fr));
        gap: 0.65rem;
        padding: 0.75rem 1rem 1rem;
    }
    .pm-order-card {
        border-radius: 8px;
        padding: 0.65rem 0.7rem;
        border: 1px solid #e2e8f0;
        background: #fafbfc;
        transition: transform 0.15s, box-shadow 0.15s;
        cursor: default;
    }
    .pm-order-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .pm-order-picked    { border-left: 3px solid #10b981; }
    .pm-order-inprogress{ border-left: 3px solid #f59e0b; }
    .pm-order-pending   { border-left: 3px solid #ef4444; }
    .pm-order-cancelled { border-left: 3px solid #94a3b8; opacity: 0.7; }

    .pm-order-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.3rem;
        margin-bottom: 0.35rem;
    }
    .pm-order-num {
        font-size: 0.78rem;
        font-weight: 700;
        color: #1e293b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 90px;
    }
    .pm-order-customer {
        font-size: 0.72rem;
        color: #475569;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 0.45rem;
    }
    .pm-order-meta {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }
    .pm-meta-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.67rem;
        color: #64748b;
    }
    .pm-meta-row span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* ── Empty / error states ──────────────────────── */
    .pm-empty {
        text-align: center;
        padding: 4rem 2rem;
        color: #64748b;
    }
    .pm-empty i { font-size: 3.5rem; color: #cbd5e1; margin-bottom: 1rem; display: block; }

    /* ── Panel buttons ─────────────────────────────── */
    .pm-home-btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.6rem 0.9rem;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        background: white;
        color: #1e293b;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        width: 100%;
        transition: all 0.15s;
    }
    .pm-home-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }

    .pm-fetch-btn {
        width: 100%;
        padding: 0.65rem;
        border: none;
        border-radius: 8px;
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: white;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        transition: opacity 0.15s;
        margin-top: 0.5rem;
    }
    .pm-fetch-btn:hover   { opacity: 0.9; }
    .pm-fetch-btn:disabled{ opacity: 0.55; cursor: not-allowed; }

    .pm-refresh-btn {
        width: 100%;
        padding: 0.55rem;
        border: 1px solid #6366f1;
        border-radius: 8px;
        background: white;
        color: #6366f1;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        transition: all 0.15s;
    }
    .pm-refresh-btn:hover   { background: #eef2ff; }
    .pm-refresh-btn:disabled{ opacity: 0.45; cursor: not-allowed; }

    .pm-last-updated {
        font-size: 0.67rem;
        color: #94a3b8;
        text-align: center;
        margin-top: 0.5rem;
    }

    /* ── No-data placeholder ───────────────────────── */
    .pm-placeholder {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        color: #64748b;
        padding: 3rem;
    }
    .pm-placeholder i {
        font-size: 4rem;
        color: #e2e8f0;
        margin-bottom: 1.25rem;
    }
    .pm-placeholder h3 { color: #334155; margin-bottom: 0.5rem; }
    `;

    // Inject styles once
    if (!document.getElementById('pm-styles')) {
        const style = document.createElement('style');
        style.id = 'pm-styles';
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    // ── State ────────────────────────────────────────────────────────────────
    let pmRawData     = [];
    let pmViewMode    = 'picker';
    let pmLastUpdated = null;

    // ── Date helpers ─────────────────────────────────────────────────────────
    function fmtApex(dateStr) {
        const d = new Date(dateStr);
        return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
    }

    function todayIso() {
        return new Date().toISOString().split('T')[0];
    }

    function fmtTime(d) {
        if (!d) return '—';
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    // ── Picking status detection ─────────────────────────────────────────────
    function pickStatus(row) {
        const total   = Number(row.total_lines)  || 0;
        const picked  = Number(row.picked_lines) || 0;
        const balance = Number(row.balance_lines);
        if (total === 0) return 'pending';
        if (picked === total) return 'picked';
        if (picked > 0) return 'inprogress';
        return 'pending';
    }

    // ── DOM ready ─────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        const page = document.getElementById('picker-management');
        if (!page) return;

        // Pre-fill today's date
        const dateInput = document.getElementById('pm-date');
        if (dateInput) dateInput.value = todayIso();

        // Watch for page visibility
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                if (m.attributeName === 'style') {
                    const visible = page.style.display !== 'none';
                    if (visible && pmRawData.length === 0) {
                        // Auto-fetch for today when page first shown
                        const d = document.getElementById('pm-date');
                        if (d && d.value) pmFetchData();
                    }
                }
            });
        });
        observer.observe(page, { attributes: true });
    });

    // ── Fetch data ────────────────────────────────────────────────────────────
    window.pmFetchData = function () {
        const dateVal    = document.getElementById('pm-date')?.value;
        const instanceEl = document.getElementById('pm-instance');
        const instance   = instanceEl?.value || 'PROD';

        if (!dateVal) { alert('Please select a date.'); return; }

        const apexDate = fmtApex(dateVal);
        const url = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/getpickersview?P_INSTANCE_NAME=${instance}&P_ASSIGNMENT_DATE=${apexDate}`;

        console.log('[PickerMonitor] Fetching:', url);
        pmSetLoading(true);

        const done = function (error, data) {
            pmSetLoading(false);
            if (error) { pmShowError(error); return; }
            try {
                let rows = JSON.parse(data);
                if (!Array.isArray(rows) && rows?.items) rows = rows.items;
                if (!Array.isArray(rows)) rows = [];
                pmRawData     = rows;
                pmLastUpdated = new Date();
                pmBuildFilters();
                pmRender();
                const lu = document.getElementById('pm-last-updated');
                if (lu) lu.textContent = 'Updated: ' + fmtTime(pmLastUpdated);
            } catch (e) {
                pmShowError('Parse error: ' + e.message);
            }
        };

        if (window.chrome && window.chrome.webview) {
            sendMessageToCSharp({ action: 'executeGet', fullUrl: url }, done);
        } else {
            fetch(url).then(r => r.text()).then(d => done(null, d)).catch(e => done(e.message, null));
        }
    };

    // ── Refresh (only works when date already selected) ───────────────────────
    window.pmRefresh = function () {
        const dateVal = document.getElementById('pm-date')?.value;
        if (!dateVal) { alert('Select a date first.'); return; }
        pmFetchData();
    };

    // ── Build filter dropdowns from raw data ──────────────────────────────────
    function pmBuildFilters() {
        const pickers = [...new Set(pmRawData.map(r => r.picker_name  || '').filter(Boolean))].sort();
        const lorries = [...new Set(pmRawData.map(r => r.lorry_number || '').filter(Boolean))].sort();
        const bays    = [...new Set(pmRawData.map(r => r.loading_bay  || '').filter(Boolean))].sort();

        pmPopulateSelect('pm-filter-picker', pickers, 'All Pickers');
        pmPopulateSelect('pm-filter-lorry',  lorries, 'All Lorries');
        pmPopulateSelect('pm-filter-bay',    bays,    'All Bays');

        // Enable refresh now that data exists
        const rb = document.getElementById('pm-refresh-btn');
        if (rb) rb.disabled = false;
    }

    function pmPopulateSelect(id, values, allLabel) {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = `<option value="">${allLabel}</option>` +
            values.map(v => `<option value="${v}">${v}</option>`).join('');
    }

    // ── Filtered data ─────────────────────────────────────────────────────────
    function pmFilteredData() {
        const pickerF = (document.getElementById('pm-filter-picker')?.value || '').trim();
        const lorryF  = (document.getElementById('pm-filter-lorry')?.value  || '').trim();
        const bayF    = (document.getElementById('pm-filter-bay')?.value     || '').trim();

        return pmRawData.filter(r => {
            if (pickerF && (r.picker_name  || '') !== pickerF) return false;
            if (lorryF  && (r.lorry_number || '') !== lorryF)  return false;
            if (bayF    && (r.loading_bay  || '') !== bayF)    return false;
            return true;
        });
    }

    // ── Main render ───────────────────────────────────────────────────────────
    window.pmRender = function () {
        const data = pmFilteredData();
        pmUpdateSummary(data);

        const container = document.getElementById('pm-cards-area');
        if (!container) return;

        if (pmRawData.length === 0) {
            container.innerHTML = `<div class="pm-placeholder">
                <i class="fas fa-hard-hat"></i>
                <h3>No Data Loaded</h3>
                <p>Select a date and click <strong>Fetch Data</strong> to monitor picking progress.</p>
            </div>`;
            return;
        }

        if (data.length === 0) {
            container.innerHTML = `<div class="pm-placeholder">
                <i class="fas fa-filter"></i>
                <h3>No Results</h3>
                <p>No orders match the selected filters. Try clearing some filters.</p>
            </div>`;
            return;
        }

        if (pmViewMode === 'picker') renderByPicker(container, data);
        else if (pmViewMode === 'lorry') renderByLorry(container, data);
        else renderByBay(container, data);
    };

    // ── Summary bar ───────────────────────────────────────────────────────────
    function pmUpdateSummary(data) {
        const summaryEl = document.getElementById('pm-summary');
        if (!summaryEl) return;

        if (data.length === 0) {
            summaryEl.innerHTML = '';
            return;
        }

        const totalOrders  = data.length;
        const totalPickers = new Set(data.map(r => r.picker_name  || '').filter(Boolean)).size;
        const totalLorries = new Set(data.map(r => r.lorry_number || '').filter(Boolean)).size;
        const totalBays    = new Set(data.map(r => r.loading_bay  || '').filter(Boolean)).size;
        const pickedCount  = data.filter(r => pickStatus(r) === 'picked').length;
        const inProgCount  = data.filter(r => pickStatus(r) === 'inprogress').length;
        const pendingCount = data.filter(r => pickStatus(r) === 'pending').length;
        const totalLines   = data.reduce((s, r) => s + (Number(r.total_lines)  || 0), 0);
        const pickedLines  = data.reduce((s, r) => s + (Number(r.picked_lines) || 0), 0);
        const pct          = totalLines ? Math.round(pickedLines / totalLines * 100) : 0;
        const progColor    = pct === 100 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';

        summaryEl.innerHTML = `
        <div class="pm-stat-card" style="border-left-color:#6366f1;">
            <div class="pm-stat-val">${totalPickers}</div>
            <div class="pm-stat-lbl"><i class="fas fa-user-tie"></i> Pickers</div>
        </div>
        <div class="pm-stat-card" style="border-left-color:#0ea5e9;">
            <div class="pm-stat-val">${totalLorries}</div>
            <div class="pm-stat-lbl"><i class="fas fa-truck"></i> Lorries</div>
        </div>
        <div class="pm-stat-card" style="border-left-color:#8b5cf6;">
            <div class="pm-stat-val">${totalBays}</div>
            <div class="pm-stat-lbl"><i class="fas fa-warehouse"></i> Bays</div>
        </div>
        <div class="pm-stat-card" style="border-left-color:#64748b;">
            <div class="pm-stat-val">${totalOrders}</div>
            <div class="pm-stat-lbl"><i class="fas fa-box"></i> Orders</div>
        </div>
        <div class="pm-stat-card" style="border-left-color:#64748b;">
            <div class="pm-stat-val">${totalLines}</div>
            <div class="pm-stat-lbl"><i class="fas fa-list"></i> Total Lines</div>
        </div>
        <div class="pm-stat-card" style="border-left-color:#10b981;">
            <div class="pm-stat-val">${pickedLines}</div>
            <div class="pm-stat-lbl"><i class="fas fa-check-circle"></i> Lines Picked</div>
        </div>
        <div class="pm-stat-card" style="border-left-color:#ef4444;">
            <div class="pm-stat-val">${totalLines - pickedLines}</div>
            <div class="pm-stat-lbl"><i class="fas fa-clock"></i> Lines Balance</div>
        </div>
        <div class="pm-stat-card" style="border-left-color:#10b981;">
            <div class="pm-stat-val">${pickedCount}</div>
            <div class="pm-stat-lbl"><i class="fas fa-check-double"></i> Orders Picked</div>
        </div>
        <div class="pm-stat-card" style="border-left-color:#f59e0b;">
            <div class="pm-stat-val">${inProgCount}</div>
            <div class="pm-stat-lbl"><i class="fas fa-spinner"></i> In Progress</div>
        </div>
        <div class="pm-stat-card" style="border-left-color:#ef4444;">
            <div class="pm-stat-val">${pendingCount}</div>
            <div class="pm-stat-lbl"><i class="fas fa-clock"></i> Pending</div>
        </div>
        <div class="pm-stat-card" style="border-left-color:${progColor};background:linear-gradient(135deg,${progColor === '#10b981' ? '#10b981,#059669' : progColor === '#f59e0b' ? '#f59e0b,#d97706' : '#ef4444,#dc2626'});color:white;">
            <div class="pm-stat-val" style="color:white;">${pct}%</div>
            <div class="pm-stat-lbl" style="color:rgba(255,255,255,0.85);"><i class="fas fa-chart-pie"></i> Complete</div>
            <div style="margin-top:0.4rem;height:5px;background:rgba(255,255,255,0.3);border-radius:99px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:white;border-radius:99px;transition:width 0.5s;"></div>
            </div>
        </div>`;
    }

    // ── By Picker ─────────────────────────────────────────────────────────────
    function renderByPicker(container, data) {
        const groups = groupBy(data, r => r.picker_name || 'Unassigned');
        container.innerHTML = '';
        Object.entries(groups)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([name, orders]) => {
                const lorries = [...new Set(orders.map(r => r.lorry_number || '').filter(Boolean))];
                const bays    = [...new Set(orders.map(r => r.loading_bay  || '').filter(Boolean))];
                const block = buildGroupBlock(name, orders, {
                    icon:          'fas fa-user-hard-hat',
                    iconBg:        'linear-gradient(135deg,#6366f1,#4f46e5)',
                    groupSubtitle: `Lorry: ${lorries.join(', ') || '—'} | Bay: ${bays.join(', ') || '—'}`
                });
                container.appendChild(block);
            });
    }

    // ── By Lorry ──────────────────────────────────────────────────────────────
    function renderByLorry(container, data) {
        const groups = groupBy(data, r => r.lorry_number || 'Unknown');
        container.innerHTML = '';
        Object.entries(groups)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([lorry, orders]) => {
                const bays    = [...new Set(orders.map(r => r.loading_bay  || '').filter(Boolean))];
                const pickers = [...new Set(orders.map(r => r.picker_name  || '').filter(Boolean))];
                const block = buildGroupBlock(lorry, orders, {
                    icon:          'fas fa-truck',
                    iconBg:        'linear-gradient(135deg,#0ea5e9,#0284c7)',
                    groupSubtitle: `Bay: ${bays.join(', ') || '—'} | Pickers: ${pickers.join(', ') || '—'}`
                });
                container.appendChild(block);
            });
    }

    // ── By Loading Bay ────────────────────────────────────────────────────────
    function renderByBay(container, data) {
        const groups = groupBy(data, r => r.loading_bay || 'No Bay');
        container.innerHTML = '';
        Object.entries(groups)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([bay, orders]) => {
                const lorries = [...new Set(orders.map(r => r.lorry_number || '').filter(Boolean))];
                const pickers = [...new Set(orders.map(r => r.picker_name  || '').filter(Boolean))];
                const block = buildGroupBlock(bay, orders, {
                    icon:          'fas fa-warehouse',
                    iconBg:        'linear-gradient(135deg,#10b981,#059669)',
                    groupSubtitle: `Lorries: ${lorries.join(', ') || '—'} | Pickers: ${pickers.join(', ') || '—'}`
                });
                container.appendChild(block);
            });
    }

    // ── Group block ───────────────────────────────────────────────────────────
    function buildGroupBlock(title, orders, opts) {
        const total       = orders.length;
        const picked      = orders.filter(r => pickStatus(r) === 'picked').length;
        const inProg      = orders.filter(r => pickStatus(r) === 'inprogress').length;
        const pending     = orders.filter(r => pickStatus(r) === 'pending').length;
        const totalLines  = orders.reduce((s, r) => s + (Number(r.total_lines)  || 0), 0);
        const pickedLines = orders.reduce((s, r) => s + (Number(r.picked_lines) || 0), 0);
        const pct         = totalLines ? Math.round(pickedLines / totalLines * 100) : 0;

        const progGrad = pct === 100
            ? 'linear-gradient(90deg,#10b981,#059669)'
            : pct >= 50
                ? 'linear-gradient(90deg,#f59e0b,#d97706)'
                : 'linear-gradient(90deg,#ef4444,#dc2626)';
        const progTextColor = pct === 100 ? '#065f46' : pct >= 50 ? '#92400e' : '#991b1b';

        const wrap = document.createElement('div');
        wrap.className = 'pm-group-block';

        // ── Header ──────────────────────────────────
        const header = document.createElement('div');
        header.className = 'pm-group-header';
        header.innerHTML = `
            <div style="display:flex;align-items:center;gap:0.75rem;flex:1;min-width:0;">
                <div style="width:42px;height:42px;border-radius:10px;background:${opts.iconBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 3px 8px rgba(0,0,0,0.15);">
                    <i class="${opts.icon}" style="color:white;font-size:1.1rem;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.95rem;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>
                    ${opts.groupSubtitle ? `<div style="font-size:0.7rem;color:#64748b;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${opts.groupSubtitle}</div>` : ''}
                </div>
            </div>
            <div style="display:flex;gap:0.35rem;align-items:center;flex-wrap:wrap;justify-content:flex-end;margin-top:0.25rem;">
                <span class="pm-badge pm-badge-total">${total} orders</span>
                <span class="pm-badge pm-badge-total">${totalLines} lines</span>
                <span class="pm-badge pm-badge-picked">${pickedLines} picked</span>
                <span class="pm-badge pm-badge-pending">${totalLines - pickedLines} balance</span>
                ${inProg  ? `<span class="pm-badge pm-badge-inprog">${inProg} in-prog</span>`   : ''}
                ${pending ? `<span class="pm-badge pm-badge-pending">${pending} pending</span>` : ''}
            </div>
        `;

        // ── Progress bar ─────────────────────────────
        const progWrap = document.createElement('div');
        progWrap.style.cssText = 'padding:0.4rem 1rem 0.7rem;background:#fcfcfd;';
        progWrap.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
                <span style="font-size:0.68rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Lines Picked ${pickedLines}/${totalLines}</span>
                <span style="font-size:0.75rem;font-weight:800;color:${progTextColor};">${pct}%</span>
            </div>
            <div style="height:8px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${progGrad};border-radius:99px;transition:width 0.6s ease;"></div>
            </div>
        `;

        // ── Order cards ──────────────────────────────
        const cardsGrid = document.createElement('div');
        cardsGrid.className = 'pm-orders-grid';

        orders.forEach(row => {
            const st          = pickStatus(row);
            const orderNum    = row.source_order_number || '—';
            const lorry       = row.lorry_number   || '—';
            const bay         = row.loading_bay    || '—';
            const picker      = row.picker_name    || '—';
            const priority    = row.order_priority || '';
            const totalL      = Number(row.total_lines)  || 0;
            const pickedL     = Number(row.picked_lines) || 0;
            const balanceL    = Number(row.balance_lines) || 0;
            const cardPct     = totalL ? Math.round(pickedL / totalL * 100) : 0;
            const progFill    = cardPct === 100
                ? 'linear-gradient(90deg,#10b981,#059669)'
                : cardPct > 0 ? 'linear-gradient(90deg,#f59e0b,#d97706)' : '#ef4444';
            const stLabel     = st === 'picked' ? 'Picked' : st === 'inprogress' ? 'In Progress' : 'Pending';

            const card = document.createElement('div');
            card.className = `pm-order-card pm-order-${st}`;
            card.innerHTML = `
                <div class="pm-order-header">
                    <span class="pm-order-num" title="${orderNum}">#${orderNum}</span>
                    ${statusBadge(st, stLabel)}
                </div>
                <div style="margin-bottom:0.4rem;">
                    <div style="display:flex;justify-content:space-between;font-size:0.62rem;color:#64748b;margin-bottom:0.15rem;">
                        <span>${pickedL}/${totalL} lines</span>
                        <span style="font-weight:700;">${cardPct}%</span>
                    </div>
                    <div style="height:4px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
                        <div style="height:100%;width:${cardPct}%;background:${progFill};border-radius:99px;"></div>
                    </div>
                    <div style="font-size:0.6rem;color:#94a3b8;margin-top:0.15rem;">${balanceL} balance</div>
                </div>
                <div class="pm-order-meta">
                    ${pmViewMode !== 'lorry'  ? `<div class="pm-meta-row"><i class="fas fa-truck"     style="color:#6366f1;width:12px;text-align:center;"></i><span title="${lorry}">${lorry}</span></div>` : ''}
                    ${pmViewMode !== 'bay'    ? `<div class="pm-meta-row"><i class="fas fa-warehouse" style="color:#10b981;width:12px;text-align:center;"></i><span>Bay ${bay}</span></div>` : ''}
                    ${pmViewMode !== 'picker' ? `<div class="pm-meta-row"><i class="fas fa-user"      style="color:#f59e0b;width:12px;text-align:center;"></i><span title="${picker}">${picker}</span></div>` : ''}
                    ${priority ? `<div class="pm-meta-row"><i class="fas fa-flag" style="color:#94a3b8;width:12px;text-align:center;"></i><span>Priority ${priority}</span></div>` : ''}
                </div>
            `;
            cardsGrid.appendChild(card);
        });

        wrap.appendChild(header);
        wrap.appendChild(progWrap);
        wrap.appendChild(cardsGrid);
        return wrap;
    }

    // ── Status badge ──────────────────────────────────────────────────────────
    function statusBadge(st, rawLabel) {
        const cfg = {
            picked:      { bg: '#d1fae5', color: '#065f46', icon: 'fa-check-circle'   },
            inprogress:  { bg: '#fef3c7', color: '#92400e', icon: 'fa-spinner'         },
            pending:     { bg: '#fee2e2', color: '#991b1b', icon: 'fa-clock'           },
            cancelled:   { bg: '#f1f5f9', color: '#475569', icon: 'fa-ban'             },
        };
        const c = cfg[st] || cfg.pending;
        const label = rawLabel.length > 16 ? rawLabel.substring(0, 14) + '…' : rawLabel;
        return `<span style="background:${c.bg};color:${c.color};padding:0.18rem 0.45rem;border-radius:6px;font-size:0.62rem;font-weight:700;display:inline-flex;align-items:center;gap:0.25rem;white-space:nowrap;flex-shrink:0;">
            <i class="fas ${c.icon}"></i>${label}
        </span>`;
    }

    // ── View mode toggle ──────────────────────────────────────────────────────
    window.pmSetView = function (mode) {
        pmViewMode = mode;
        document.querySelectorAll('.pm-view-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.view === mode);
        });
        if (pmRawData.length > 0) pmRender();
    };

    // ── Filter change ─────────────────────────────────────────────────────────
    window.pmApplyFilters = function () {
        if (pmRawData.length > 0) pmRender();
    };

    window.pmClearFilters = function () {
        ['pm-filter-picker', 'pm-filter-lorry', 'pm-filter-bay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        if (pmRawData.length > 0) pmRender();
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    function groupBy(arr, keyFn) {
        return arr.reduce((acc, item) => {
            const k = keyFn(item);
            (acc[k] = acc[k] || []).push(item);
            return acc;
        }, {});
    }

    function pmSetLoading(on) {
        const btn  = document.getElementById('pm-fetch-btn');
        const rBtn = document.getElementById('pm-refresh-btn');
        const area = document.getElementById('pm-cards-area');
        if (btn)  { btn.disabled  = on; btn.innerHTML = on ? '<i class="fas fa-circle-notch fa-spin"></i> Loading...' : '<i class="fas fa-sync-alt"></i> Fetch Data'; }
        if (rBtn) { rBtn.disabled = on; }
        if (on && area) {
            area.innerHTML = `<div style="text-align:center;padding:5rem;color:#6366f1;">
                <i class="fas fa-circle-notch fa-spin" style="font-size:3.5rem;margin-bottom:1.25rem;opacity:0.7;"></i>
                <p style="font-weight:600;color:#334155;font-size:1rem;">Loading picking data…</p>
            </div>`;
            const s = document.getElementById('pm-summary');
            if (s) s.innerHTML = '';
        }
    }

    function pmShowError(msg) {
        const area = document.getElementById('pm-cards-area');
        if (area) area.innerHTML = `<div style="text-align:center;padding:4rem;color:#ef4444;">
            <i class="fas fa-exclamation-triangle" style="font-size:2.5rem;margin-bottom:1rem;"></i>
            <p style="font-weight:600;">${msg}</p>
        </div>`;
    }

    console.log('[PickerMonitor] ✅ Module loaded');
})();

// ============================================================================
// PICKING TIME MONITOR
// ============================================================================

console.log('[PickingTimeMonitor] Loading...');

// Global variables
let ptmRawData = [];
let ptmOrderGrid = null;
let ptmPickerGrid = null;
let ptmLorryGrid = null;
let ptmPriorityGrid = null;
let ptmBayGrid = null;
let ptmPickerChart = null;
let ptmLorryChart = null;
let ptmPriorityChart = null;
let ptmBayChart = null;

const PTM_API = API_CONFIG.APEX_BASE_URL + '/pickertimeperformance';

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function () {
    console.log('[PickingTimeMonitor] DOM ready');

    // Set default dates to today
    const today = new Date().toISOString().split('T')[0];
    const dateFrom = document.getElementById('ptm-date-from');
    const dateTo = document.getElementById('ptm-date-to');
    if (dateFrom) dateFrom.value = today;
    if (dateTo) dateTo.value = today;

    // Setup collapse toggle for parameters panel
    const toggle = document.getElementById('ptm-parameters-toggle');
    const content = document.getElementById('ptm-parameters-content');
    const collapseIcon = document.getElementById('ptm-collapse-icon');
    if (toggle && content && collapseIcon) {
        toggle.addEventListener('click', function () {
            content.classList.toggle('collapsed');
            collapseIcon.classList.toggle('collapsed');
        });
    }

    // Observe page visibility to init grids on first show
    const page = document.getElementById('picking-time-monitor');
    if (page) {
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.attributeName === 'style') {
                    const isVisible = page.style.display !== 'none';
                    if (isVisible) {
                        console.log('[PickingTimeMonitor] Page shown, initializing grids');
                        ptmInitGrids();
                    }
                }
            });
        });
        observer.observe(page, { attributes: true });
    }
});

function ptmInitGrids() {
    if (!ptmOrderGrid) ptmInitOrderGrid();
    if (!ptmPickerGrid) ptmInitPickerGrid();
    if (!ptmLorryGrid) ptmInitLorryGrid();
    if (!ptmPriorityGrid) ptmInitPriorityGrid();
    if (!ptmBayGrid) ptmInitBayGrid();
}

// ============================================================================
// LOAD DATA
// ============================================================================

window.ptmLoadData = function () {
    const fromDate = document.getElementById('ptm-date-from').value;
    const toDate = document.getElementById('ptm-date-to').value;

    if (!fromDate || !toDate) {
        alert('Please select both From Date and To Date.');
        return;
    }

    const btn  = document.getElementById('ptm-load-btn');
    const icon = document.getElementById('ptm-load-icon');
    const text = document.getElementById('ptm-load-text');

    btn.disabled = true;
    icon.classList.add('fa-spin');
    text.textContent = 'Loading...';

    const url = PTM_API + '?FROM_DATE=' + fromDate + '&TO_DATE=' + toDate;
    console.log('[PickingTimeMonitor] Fetching:', url);

    sendMessageToCSharp({ action: 'executeGet', fullUrl: url }, function (error, data) {
        btn.disabled = false;
        icon.classList.remove('fa-spin');
        text.textContent = 'Load Data';

        if (error) {
            console.error('[PickingTimeMonitor] Error:', error);
            if (typeof showNotification === 'function') {
                showNotification('Error loading data: ' + error, 'error');
            } else {
                alert('Error loading data: ' + error);
            }
            return;
        }

        try {
            const result = typeof data === 'string' ? JSON.parse(data) : data;
            ptmRawData = result.data || [];
            console.log('[PickingTimeMonitor] Loaded', ptmRawData.length, 'records');

            ptmUpdateSummaryCards();
            ptmUpdateAllGrids();
            ptmUpdateCharts();

            if (typeof showNotification === 'function') {
                showNotification('Loaded ' + ptmRawData.length + ' records', 'success');
            }
        } catch (parseError) {
            console.error('[PickingTimeMonitor] Parse error:', parseError);
            if (typeof showNotification === 'function') {
                showNotification('Error parsing response: ' + parseError.message, 'error');
            }
        }
    });
};

// ============================================================================
// SUMMARY CARDS
// ============================================================================

function ptmUpdateSummaryCards() {
    const data = ptmRawData;
    const totalOrders = data.length;
    const uniquePickers = new Set(data.map(r => r.picker_name)).size;
    const uniqueLorries = new Set(data.map(r => r.trip_lorry)).size;
    const totalLines = data.reduce((sum, r) => sum + (r.total_lines || 0), 0);
    const avgMinutes = totalOrders > 0
        ? (data.reduce((sum, r) => sum + (r.total_minutes || 0), 0) / totalOrders).toFixed(1)
        : 0;
    const allMinutes = data.map(r => r.total_minutes || 0);
    const fastest = totalOrders > 0 ? Math.min(...allMinutes) : 0;
    const slowest = totalOrders > 0 ? Math.max(...allMinutes) : 0;

    document.getElementById('ptm-stat-orders').textContent = totalOrders;
    document.getElementById('ptm-stat-pickers').textContent = uniquePickers;
    document.getElementById('ptm-stat-lorries').textContent = uniqueLorries;
    document.getElementById('ptm-stat-lines').textContent = totalLines;
    document.getElementById('ptm-stat-avg').textContent = avgMinutes + ' min';
    document.getElementById('ptm-stat-fastest').textContent = fastest + ' min';
    document.getElementById('ptm-stat-slowest').textContent = slowest + ' min';
}

// ============================================================================
// TAB SWITCHING
// ============================================================================

window.ptmSwitchTab = function (tabName) {
    document.querySelectorAll('#ptm-tabs .tab-item').forEach(t => t.classList.remove('active'));
    const activeTab = document.querySelector(`#ptm-tabs .tab-item[data-tab="${tabName}"]`);
    if (activeTab) activeTab.classList.add('active');

    document.querySelectorAll('#ptm-tab-content .tab-pane').forEach(p => p.classList.remove('active'));
    const activePane = document.getElementById('ptm-tab-' + tabName);
    if (activePane) activePane.classList.add('active');

    // Repaint DevExtreme grids when tab becomes visible
    const gridMap = {
        'by-order': ptmOrderGrid,
        'by-picker': ptmPickerGrid,
        'by-lorry': ptmLorryGrid,
        'by-priority': ptmPriorityGrid,
        'by-bay': ptmBayGrid
    };
    if (gridMap[tabName]) {
        try { gridMap[tabName].dxDataGrid('instance').repaint(); } catch (e) {}
    }

    if (tabName === 'summary') ptmUpdateCharts();
};

// ============================================================================
// UPDATE ALL GRIDS
// ============================================================================

function ptmUpdateAllGrids() {
    if (ptmOrderGrid) ptmOrderGrid.dxDataGrid('instance').option('dataSource', ptmRawData);
    if (ptmPickerGrid) ptmPickerGrid.dxDataGrid('instance').option('dataSource', ptmAggregateByPicker());
    if (ptmLorryGrid) ptmLorryGrid.dxDataGrid('instance').option('dataSource', ptmAggregateByLorry());
    if (ptmPriorityGrid) ptmPriorityGrid.dxDataGrid('instance').option('dataSource', ptmAggregateByPriority());
    if (ptmBayGrid) ptmBayGrid.dxDataGrid('instance').option('dataSource', ptmAggregateByBay());
}

// ============================================================================
// AGGREGATION
// ============================================================================

function ptmAggregateByPicker() {
    const groups = {};
    ptmRawData.forEach(r => {
        const key = r.picker_name || 'Unknown';
        if (!groups[key]) {
            groups[key] = { orders: 0, total_lines: 0, sum_minutes: 0, min_minutes: Infinity, max_minutes: 0, lorries: new Set(), first_pick: null, last_ship: null };
        }
        groups[key].orders++;
        groups[key].total_lines += r.total_lines || 0;
        groups[key].sum_minutes += r.total_minutes || 0;
        groups[key].min_minutes = Math.min(groups[key].min_minutes, r.total_minutes || 0);
        groups[key].max_minutes = Math.max(groups[key].max_minutes, r.total_minutes || 0);
        groups[key].lorries.add(r.trip_lorry);
        // Track earliest first_pick and latest last_ship across all orders
        if (r.first_pick_time && (!groups[key].first_pick || r.first_pick_time < groups[key].first_pick)) {
            groups[key].first_pick = r.first_pick_time;
        }
        if (r.last_ship_time && (!groups[key].last_ship || r.last_ship_time > groups[key].last_ship)) {
            groups[key].last_ship = r.last_ship_time;
        }
    });
    return Object.entries(groups).map(([key, val]) => {
        const avg = Math.round(val.sum_minutes / val.orders * 10) / 10;
        const total_time = ptmTimeDiffMinutes(val.first_pick, val.last_ship);
        return {
            picker_name: key,
            total_orders: val.orders,
            total_lines: val.total_lines,
            first_pick: val.first_pick || '-',
            last_ship: val.last_ship || '-',
            total_time_minutes: total_time,
            avg_minutes: avg,
            fastest_order: val.min_minutes === Infinity ? 0 : val.min_minutes,
            slowest_order: val.max_minutes,
            lorries_count: val.lorries.size,
            performance_score: ptmCalcScore(avg, val.orders, val.total_lines)
        };
    }).sort((a, b) => a.total_time_minutes - b.total_time_minutes);
}

function ptmCalcScore(avgTime, orders, lines) {
    const timeScore = Math.max(0, 100 - avgTime * 2);
    const volumeScore = Math.min(50, orders * 2 + lines * 0.3);
    return Math.min(100, Math.round(timeScore * 0.6 + volumeScore * 0.4));
}

// Parse a time/datetime value to a comparable number (ms since epoch).
// Handles full datetime strings ("2026-03-25T08:30:00"), time-only strings
// ("08:30:00", "08:30"), and Oracle compact formats.
function ptmParseTimeMs(val) {
    if (!val) return null;
    var d = new Date(val);
    if (!isNaN(d.getTime())) return d.getTime();
    // Time-only: prefix a dummy date so Date can parse it
    d = new Date('1970-01-01T' + val);
    if (!isNaN(d.getTime())) return d.getTime();
    return null;
}

// Total minutes between two time values (last_ship - first_pick).
// Returns 0 if either value is missing or unparseable.
function ptmTimeDiffMinutes(startVal, endVal) {
    var s = ptmParseTimeMs(startVal);
    var e = ptmParseTimeMs(endVal);
    if (s === null || e === null) return 0;
    return Math.round((e - s) / 60000 * 10) / 10;
}

function ptmAggregateByLorry() {
    const groups = {};
    ptmRawData.forEach(r => {
        const key = r.trip_lorry || 'Unknown';
        if (!groups[key]) {
            groups[key] = { orders: 0, total_lines: 0, sum_minutes: 0, min_minutes: Infinity, max_minutes: 0, pickers: new Set(), trip_id: r.trip_id, loading_bay: r.trip_loading_bay, first_pick: null, last_ship: null };
        }
        groups[key].orders++;
        groups[key].total_lines += r.total_lines || 0;
        groups[key].sum_minutes += r.total_minutes || 0;
        groups[key].min_minutes = Math.min(groups[key].min_minutes, r.total_minutes || 0);
        groups[key].max_minutes = Math.max(groups[key].max_minutes, r.total_minutes || 0);
        groups[key].pickers.add(r.picker_name);
        if (r.first_pick_time && (!groups[key].first_pick || r.first_pick_time < groups[key].first_pick)) {
            groups[key].first_pick = r.first_pick_time;
        }
        if (r.last_ship_time && (!groups[key].last_ship || r.last_ship_time > groups[key].last_ship)) {
            groups[key].last_ship = r.last_ship_time;
        }
    });
    return Object.entries(groups).map(([key, val]) => ({
        trip_lorry: key,
        trip_id: val.trip_id,
        loading_bay: val.loading_bay,
        total_orders: val.orders,
        total_lines: val.total_lines,
        unique_pickers: val.pickers.size,
        first_pick: val.first_pick || '-',
        last_ship: val.last_ship || '-',
        total_time_minutes: ptmTimeDiffMinutes(val.first_pick, val.last_ship),
        avg_minutes: Math.round(val.sum_minutes / val.orders * 10) / 10,
        fastest_order: val.min_minutes === Infinity ? 0 : val.min_minutes,
        slowest_order: val.max_minutes
    })).sort((a, b) => a.total_time_minutes - b.total_time_minutes);
}

function ptmAggregateByPriority() {
    const groups = {};
    ptmRawData.forEach(r => {
        const key = r.trip_priority || 'Unknown';
        if (!groups[key]) {
            groups[key] = { orders: 0, total_lines: 0, sum_minutes: 0, min_minutes: Infinity, max_minutes: 0, pickers: new Set(), lorries: new Set(), first_pick: null, last_ship: null };
        }
        groups[key].orders++;
        groups[key].total_lines += r.total_lines || 0;
        groups[key].sum_minutes += r.total_minutes || 0;
        groups[key].min_minutes = Math.min(groups[key].min_minutes, r.total_minutes || 0);
        groups[key].max_minutes = Math.max(groups[key].max_minutes, r.total_minutes || 0);
        groups[key].pickers.add(r.picker_name);
        groups[key].lorries.add(r.trip_lorry);
        if (r.first_pick_time && (!groups[key].first_pick || r.first_pick_time < groups[key].first_pick)) {
            groups[key].first_pick = r.first_pick_time;
        }
        if (r.last_ship_time && (!groups[key].last_ship || r.last_ship_time > groups[key].last_ship)) {
            groups[key].last_ship = r.last_ship_time;
        }
    });
    return Object.entries(groups).map(([key, val]) => ({
        trip_priority: key,
        total_orders: val.orders,
        total_lines: val.total_lines,
        unique_pickers: val.pickers.size,
        unique_lorries: val.lorries.size,
        first_pick: val.first_pick || '-',
        last_ship: val.last_ship || '-',
        total_time_minutes: ptmTimeDiffMinutes(val.first_pick, val.last_ship),
        avg_minutes: Math.round(val.sum_minutes / val.orders * 10) / 10,
        fastest_order: val.min_minutes === Infinity ? 0 : val.min_minutes,
        slowest_order: val.max_minutes
    })).sort((a, b) => (a.trip_priority || '').localeCompare(b.trip_priority || ''));
}

function ptmAggregateByBay() {
    const groups = {};
    ptmRawData.forEach(r => {
        const key = r.trip_loading_bay || 'Unknown';
        if (!groups[key]) {
            groups[key] = { orders: 0, total_lines: 0, sum_minutes: 0, min_minutes: Infinity, max_minutes: 0, pickers: new Set(), lorries: new Set(), first_pick: null, last_ship: null };
        }
        groups[key].orders++;
        groups[key].total_lines += r.total_lines || 0;
        groups[key].sum_minutes += r.total_minutes || 0;
        groups[key].min_minutes = Math.min(groups[key].min_minutes, r.total_minutes || 0);
        groups[key].max_minutes = Math.max(groups[key].max_minutes, r.total_minutes || 0);
        groups[key].pickers.add(r.picker_name);
        groups[key].lorries.add(r.trip_lorry);
        if (r.first_pick_time && (!groups[key].first_pick || r.first_pick_time < groups[key].first_pick)) {
            groups[key].first_pick = r.first_pick_time;
        }
        if (r.last_ship_time && (!groups[key].last_ship || r.last_ship_time > groups[key].last_ship)) {
            groups[key].last_ship = r.last_ship_time;
        }
    });
    return Object.entries(groups).map(([key, val]) => ({
        trip_loading_bay: key,
        total_orders: val.orders,
        total_lines: val.total_lines,
        unique_pickers: val.pickers.size,
        unique_lorries: val.lorries.size,
        first_pick: val.first_pick || '-',
        last_ship: val.last_ship || '-',
        total_time_minutes: ptmTimeDiffMinutes(val.first_pick, val.last_ship),
        avg_minutes: Math.round(val.sum_minutes / val.orders * 10) / 10,
        fastest_order: val.min_minutes === Infinity ? 0 : val.min_minutes,
        slowest_order: val.max_minutes
    })).sort((a, b) => (a.trip_loading_bay || '').localeCompare(b.trip_loading_bay || ''));
}

// ============================================================================
// GRID HELPERS
// ============================================================================

function ptmMinutesCellTemplate(container, options) {
    const mins = options.value || 0;
    const bg = mins <= 15 ? '#d1fae5' : mins <= 30 ? '#fef3c7' : '#fee2e2';
    const fg = mins <= 15 ? '#059669' : mins <= 30 ? '#d97706' : '#dc2626';
    container.append(
        $('<span>').css({ background: bg, color: fg, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }).text(mins + ' min')
    );
}

function ptmPriorityCellTemplate(container, options) {
    const p = String(options.value || '-');
    const bg = p === '1' ? '#fee2e2' : p === '2' ? '#fef3c7' : '#dbeafe';
    const fg = p === '1' ? '#dc2626' : p === '2' ? '#d97706' : '#1d4ed8';
    container.append(
        $('<span>').css({ background: bg, color: fg, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }).text('P' + p)
    );
}

function ptmBaseGridOptions(exportFileName) {
    return {
        showBorders: true,
        showRowLines: true,
        showColumnLines: true,
        rowAlternationEnabled: true,
        columnAutoWidth: true,
        allowColumnReordering: true,
        allowColumnResizing: true,
        wordWrapEnabled: false,
        hoverStateEnabled: true,
        filterRow: { visible: true, applyFilter: 'auto' },
        headerFilter: { visible: true },
        searchPanel: { visible: true, width: 240, placeholder: 'Search...' },
        paging: { pageSize: 20 },
        pager: { visible: true, showPageSizeSelector: true, allowedPageSizes: [10, 20, 50, 100], showInfo: true },
        export: { enabled: true, fileName: exportFileName, allowExportSelectedData: false },
        onExporting: function (e) {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet(exportFileName);
            DevExpress.excelExporter.exportDataGrid({
                component: e.component,
                worksheet: worksheet,
                autoFilterEnabled: true,
                customizeCell: function (options) {
                    if (options.gridCell.rowType === 'header') {
                        options.excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF667EEA' } };
                        options.excelCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    }
                }
            }).then(function () {
                workbook.xlsx.writeBuffer().then(function (buffer) {
                    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), exportFileName + '_' + new Date().toISOString().split('T')[0] + '.xlsx');
                });
            });
            e.cancel = true;
        }
    };
}

// ============================================================================
// GRIDS
// ============================================================================

function ptmInitOrderGrid() {
    ptmOrderGrid = $('#ptm-order-grid').dxDataGrid(Object.assign({}, ptmBaseGridOptions('Picking_Time_By_Order'), {
        dataSource: [],
        columns: [
            { dataField: 'source_order', caption: 'Order #', width: 140, fixed: true },
            { dataField: 'picker_name', caption: 'Picker', width: 180 },
            { dataField: 'total_lines', caption: 'Lines', width: 70, dataType: 'number' },
            { dataField: 'trip_id', caption: 'Trip ID', width: 90, dataType: 'number' },
            { dataField: 'trip_date', caption: 'Trip Date', width: 110 },
            { dataField: 'trip_lorry', caption: 'Lorry', width: 140 },
            { dataField: 'trip_loading_bay', caption: 'Bay', width: 80 },
            { dataField: 'trip_priority', caption: 'Priority', width: 90, cellTemplate: ptmPriorityCellTemplate },
            { dataField: 'first_pick_time', caption: 'First Pick', width: 100 },
            { dataField: 'last_ship_time', caption: 'Last Ship', width: 100 },
            { dataField: 'total_minutes', caption: 'Total (min)', width: 120, dataType: 'number', cellTemplate: ptmMinutesCellTemplate },
            { dataField: 'instance_name', caption: 'Instance', width: 90 }
        ]
    }));
    console.log('[PickingTimeMonitor] Order grid initialized');
}

function ptmInitPickerGrid() {
    ptmPickerGrid = $('#ptm-picker-grid').dxDataGrid(Object.assign({}, ptmBaseGridOptions('Picking_Time_By_Picker'), {
        dataSource: [],
        columns: [
            { dataField: 'picker_name', caption: 'Picker Name', width: 200, fixed: true },
            { dataField: 'total_orders', caption: 'Total Orders', width: 120, dataType: 'number' },
            { dataField: 'total_lines', caption: 'Total Lines', width: 110, dataType: 'number' },
            { dataField: 'first_pick', caption: 'First Pick', width: 110 },
            { dataField: 'last_ship', caption: 'Last Ship', width: 110 },
            { dataField: 'total_time_minutes', caption: 'Total Time (min)', width: 150, dataType: 'number', sortOrder: 'asc', cellTemplate: ptmMinutesCellTemplate },
            { dataField: 'avg_minutes', caption: 'Avg/Order (min)', width: 140, dataType: 'number', cellTemplate: ptmMinutesCellTemplate },
            { dataField: 'fastest_order', caption: 'Fastest (min)', width: 130, dataType: 'number' },
            { dataField: 'slowest_order', caption: 'Slowest (min)', width: 130, dataType: 'number' },
            { dataField: 'lorries_count', caption: 'Lorries', width: 90, dataType: 'number' },
            {
                dataField: 'performance_score', caption: 'Score', width: 110, dataType: 'number',
                cellTemplate: function (container, options) {
                    const score = options.value || 0;
                    const bg = score >= 70 ? '#d1fae5' : score >= 40 ? '#fef3c7' : '#fee2e2';
                    const fg = score >= 70 ? '#059669' : score >= 40 ? '#d97706' : '#dc2626';
                    const icon = score >= 70 ? '⭐' : score >= 40 ? '👍' : '⚠️';
                    container.append($('<span>').css({ background: bg, color: fg, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }).text(icon + ' ' + score));
                }
            }
        ],
        summary: {
            totalItems: [
                { column: 'total_orders', summaryType: 'sum', displayFormat: 'Total: {0}' },
                { column: 'total_lines', summaryType: 'sum', displayFormat: 'Total: {0}' },
                { column: 'total_time_minutes', summaryType: 'avg', valueFormat: '#0.0', displayFormat: 'Avg: {0} min' },
                { column: 'avg_minutes', summaryType: 'avg', valueFormat: '#0.0', displayFormat: 'Avg: {0} min' }
            ]
        }
    }));
    console.log('[PickingTimeMonitor] Picker grid initialized');
}

function ptmInitLorryGrid() {
    ptmLorryGrid = $('#ptm-lorry-grid').dxDataGrid(Object.assign({}, ptmBaseGridOptions('Picking_Time_By_Lorry'), {
        dataSource: [],
        columns: [
            { dataField: 'trip_lorry', caption: 'Lorry', width: 160, fixed: true },
            { dataField: 'trip_id', caption: 'Trip ID', width: 90, dataType: 'number' },
            { dataField: 'loading_bay', caption: 'Loading Bay', width: 120 },
            { dataField: 'total_orders', caption: 'Total Orders', width: 120, dataType: 'number' },
            { dataField: 'total_lines', caption: 'Total Lines', width: 110, dataType: 'number' },
            { dataField: 'unique_pickers', caption: 'Pickers', width: 90, dataType: 'number' },
            { dataField: 'first_pick', caption: 'First Pick', width: 110 },
            { dataField: 'last_ship', caption: 'Last Ship', width: 110 },
            { dataField: 'total_time_minutes', caption: 'Total Time (min)', width: 150, dataType: 'number', sortOrder: 'asc', cellTemplate: ptmMinutesCellTemplate },
            { dataField: 'avg_minutes', caption: 'Avg/Order (min)', width: 140, dataType: 'number', cellTemplate: ptmMinutesCellTemplate },
            { dataField: 'fastest_order', caption: 'Fastest (min)', width: 130, dataType: 'number' },
            { dataField: 'slowest_order', caption: 'Slowest (min)', width: 130, dataType: 'number' }
        ]
    }));
    console.log('[PickingTimeMonitor] Lorry grid initialized');
}

function ptmInitPriorityGrid() {
    ptmPriorityGrid = $('#ptm-priority-grid').dxDataGrid(Object.assign({}, ptmBaseGridOptions('Picking_Time_By_Priority'), {
        dataSource: [],
        columns: [
            { dataField: 'trip_priority', caption: 'Priority', width: 100, fixed: true, cellTemplate: ptmPriorityCellTemplate },
            { dataField: 'total_orders', caption: 'Total Orders', width: 120, dataType: 'number' },
            { dataField: 'total_lines', caption: 'Total Lines', width: 110, dataType: 'number' },
            { dataField: 'unique_pickers', caption: 'Pickers', width: 90, dataType: 'number' },
            { dataField: 'unique_lorries', caption: 'Lorries', width: 90, dataType: 'number' },
            { dataField: 'first_pick', caption: 'First Pick', width: 110 },
            { dataField: 'last_ship', caption: 'Last Ship', width: 110 },
            { dataField: 'total_time_minutes', caption: 'Total Time (min)', width: 150, dataType: 'number', cellTemplate: ptmMinutesCellTemplate },
            { dataField: 'avg_minutes', caption: 'Avg/Order (min)', width: 140, dataType: 'number', cellTemplate: ptmMinutesCellTemplate },
            { dataField: 'fastest_order', caption: 'Fastest (min)', width: 130, dataType: 'number' },
            { dataField: 'slowest_order', caption: 'Slowest (min)', width: 130, dataType: 'number' }
        ]
    }));
    console.log('[PickingTimeMonitor] Priority grid initialized');
}

function ptmInitBayGrid() {
    ptmBayGrid = $('#ptm-bay-grid').dxDataGrid(Object.assign({}, ptmBaseGridOptions('Picking_Time_By_LoadingBay'), {
        dataSource: [],
        columns: [
            { dataField: 'trip_loading_bay', caption: 'Loading Bay', width: 130, fixed: true },
            { dataField: 'total_orders', caption: 'Total Orders', width: 120, dataType: 'number' },
            { dataField: 'total_lines', caption: 'Total Lines', width: 110, dataType: 'number' },
            { dataField: 'unique_pickers', caption: 'Pickers', width: 90, dataType: 'number' },
            { dataField: 'unique_lorries', caption: 'Lorries', width: 90, dataType: 'number' },
            { dataField: 'first_pick', caption: 'First Pick', width: 110 },
            { dataField: 'last_ship', caption: 'Last Ship', width: 110 },
            { dataField: 'total_time_minutes', caption: 'Total Time (min)', width: 150, dataType: 'number', cellTemplate: ptmMinutesCellTemplate },
            { dataField: 'avg_minutes', caption: 'Avg/Order (min)', width: 140, dataType: 'number', cellTemplate: ptmMinutesCellTemplate },
            { dataField: 'fastest_order', caption: 'Fastest (min)', width: 130, dataType: 'number' },
            { dataField: 'slowest_order', caption: 'Slowest (min)', width: 130, dataType: 'number' }
        ]
    }));
    console.log('[PickingTimeMonitor] Bay grid initialized');
}

// ============================================================================
// CHARTS
// ============================================================================

function ptmDestroyChart(chartRef) {
    if (chartRef) { try { chartRef.destroy(); } catch (e) {} }
    return null;
}

function ptmUpdateCharts() {
    if (ptmRawData.length === 0) return;
    ptmUpdatePickerChart();
    ptmUpdateLorryChart();
    ptmUpdatePriorityChart();
    ptmUpdateBayChart();
    ptmUpdateTopPerformers();
}

function ptmUpdatePickerChart() {
    ptmPickerChart = ptmDestroyChart(ptmPickerChart);
    const data = ptmAggregateByPicker().slice(0, 10);
    const ctx = document.getElementById('ptm-chart-picker');
    if (!ctx) return;
    ptmPickerChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(p => p.picker_name),
            datasets: [
                {
                    label: 'Total Time (min)',
                    data: data.map(p => p.total_time_minutes),
                    backgroundColor: data.map(p => p.total_time_minutes <= 30 ? 'rgba(5,150,105,0.75)' : p.total_time_minutes <= 60 ? 'rgba(217,119,6,0.75)' : 'rgba(220,38,38,0.75)'),
                    borderColor: data.map(p => p.total_time_minutes <= 30 ? '#059669' : p.total_time_minutes <= 60 ? '#d97706' : '#dc2626'),
                    borderWidth: 1,
                    yAxisID: 'y'
                },
                {
                    label: 'Total Orders',
                    type: 'line',
                    data: data.map(p => p.total_orders),
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102,126,234,0.15)',
                    borderWidth: 2,
                    pointRadius: 4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                title: { display: true, text: 'Picker Performance — Top 10 (fastest total time first)' }
            },
            scales: {
                x: { ticks: { maxRotation: 40, font: { size: 10 } } },
                y: { type: 'linear', position: 'left', title: { display: true, text: 'Total Time (min)' } },
                y1: { type: 'linear', position: 'right', title: { display: true, text: 'Total Orders' }, grid: { drawOnChartArea: false } }
            }
        }
    });
}

function ptmUpdateLorryChart() {
    ptmLorryChart = ptmDestroyChart(ptmLorryChart);
    const data = ptmAggregateByLorry();
    const ctx = document.getElementById('ptm-chart-lorry');
    if (!ctx) return;
    ptmLorryChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(l => l.trip_lorry),
            datasets: [
                { label: 'Total Time (min)', data: data.map(l => l.total_time_minutes), backgroundColor: 'rgba(102,126,234,0.75)', borderColor: '#667eea', borderWidth: 1 },
                { label: 'Total Orders', data: data.map(l => l.total_orders), backgroundColor: 'rgba(16,185,129,0.75)', borderColor: '#10b981', borderWidth: 1 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' }, title: { display: true, text: 'Total Picking Time by Lorry (last ship − first pick)' } },
            scales: { x: { ticks: { maxRotation: 40, font: { size: 10 } } } }
        }
    });
}

function ptmUpdatePriorityChart() {
    ptmPriorityChart = ptmDestroyChart(ptmPriorityChart);
    const data = ptmAggregateByPriority();
    const ctx = document.getElementById('ptm-chart-priority');
    if (!ctx) return;
    const palette = ['rgba(220,38,38,0.8)', 'rgba(217,119,6,0.8)', 'rgba(5,150,105,0.8)', 'rgba(102,126,234,0.8)', 'rgba(139,92,246,0.8)'];
    ptmPriorityChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.map(p => 'Priority ' + p.trip_priority),
            datasets: [{
                data: data.map(p => p.total_orders),
                backgroundColor: palette.slice(0, data.length),
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                title: { display: true, text: 'Orders by Priority' },
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            const d = data[ctx.dataIndex];
                            return ['Orders: ' + d.total_orders, 'Total Time: ' + d.total_time_minutes + ' min', 'Avg/Order: ' + d.avg_minutes + ' min'];
                        }
                    }
                }
            }
        }
    });
}

function ptmUpdateBayChart() {
    ptmBayChart = ptmDestroyChart(ptmBayChart);
    const data = ptmAggregateByBay();
    const ctx = document.getElementById('ptm-chart-bay');
    if (!ctx) return;
    ptmBayChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(b => b.trip_loading_bay),
            datasets: [
                { label: 'Total Time (min)', data: data.map(b => b.total_time_minutes), backgroundColor: 'rgba(139,92,246,0.75)', borderColor: '#8b5cf6', borderWidth: 1 },
                { label: 'Total Orders', data: data.map(b => b.total_orders), backgroundColor: 'rgba(251,191,36,0.75)', borderColor: '#fbbf24', borderWidth: 1 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' }, title: { display: true, text: 'Total Picking Time by Loading Bay (last ship − first pick)' } }
        }
    });
}

// ============================================================================
// TOP PERFORMERS WIDGET
// ============================================================================

function ptmUpdateTopPerformers() {
    const container = document.getElementById('ptm-top-performers');
    if (!container) return;
    const top5 = ptmAggregateByPicker().slice(0, 5);
    if (top5.length === 0) {
        container.innerHTML = '<div style="padding:2rem;text-align:center;color:#9ca3af;">No data available</div>';
        return;
    }
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    container.innerHTML = top5.map((p, i) => {
        const fg = p.total_time_minutes <= 30 ? '#059669' : p.total_time_minutes <= 60 ? '#d97706' : '#dc2626';
        const scoreFg = p.performance_score >= 70 ? '#059669' : p.performance_score >= 40 ? '#d97706' : '#dc2626';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f3f4f6;${i === 0 ? 'background:#f0fdf4;' : ''}">
            <div style="display:flex;align-items:center;gap:12px;">
                <span style="font-size:20px;min-width:30px;">${medals[i]}</span>
                <div>
                    <div style="font-weight:600;color:#1f2937;font-size:14px;">${p.picker_name}</div>
                    <div style="font-size:12px;color:#6b7280;">${p.total_orders} orders &bull; ${p.total_lines} lines &bull; ${p.lorries_count} lorr${p.lorries_count === 1 ? 'y' : 'ies'}</div>
                    <div style="font-size:11px;color:#9ca3af;">${p.first_pick} &rarr; ${p.last_ship}</div>
                </div>
            </div>
            <div style="text-align:right;">
                <div style="font-weight:700;color:${fg};font-size:15px;">${p.total_time_minutes} min total</div>
                <div style="font-size:11px;color:#6b7280;">Avg/order: ${p.avg_minutes} min</div>
                <div style="font-size:11px;color:${scoreFg};font-weight:600;">Score: ${p.performance_score}/100</div>
            </div>
        </div>`;
    }).join('');
}

// ============================================================================
// PDF EXPORT (Print)
// ============================================================================

window.ptmExportPdf = function (viewName) {
    const dataMap = {
        order: ptmRawData,
        picker: ptmAggregateByPicker(),
        lorry: ptmAggregateByLorry(),
        priority: ptmAggregateByPriority(),
        bay: ptmAggregateByBay()
    };
    const data = dataMap[viewName] || [];
    if (data.length === 0) { alert('No data to export. Please load data first.'); return; }

    const titleMap = { order: 'By Order', picker: 'By Picker', lorry: 'By Lorry', priority: 'By Priority', bay: 'By Loading Bay' };
    const title = 'Picking Time Monitor — ' + (titleMap[viewName] || viewName);
    const fromDate = document.getElementById('ptm-date-from').value;
    const toDate = document.getElementById('ptm-date-to').value;
    const keys = Object.keys(data[0]);

    const printWin = window.open('', '_blank');
    printWin.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>
        body{font-family:Arial,sans-serif;font-size:11px;margin:20px;color:#1f2937}
        h2{color:#667eea;margin:0 0 4px}p{color:#6b7280;margin:0 0 16px;font-size:12px}
        table{border-collapse:collapse;width:100%}
        th{background:#667eea;color:#fff;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase}
        td{padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:11px}
        tr:nth-child(even){background:#f9fafb}
        @media print{body{margin:8px}}
    </style></head><body>
        <h2>${title}</h2>
        <p>Date Range: ${fromDate} to ${toDate} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; Records: ${data.length}</p>
        <table>
            <thead><tr>${keys.map(k => `<th>${k.replace(/_/g, ' ')}</th>`).join('')}</tr></thead>
            <tbody>${data.map(row => `<tr>${keys.map(k => `<td>${row[k] !== undefined && row[k] !== null ? row[k] : ''}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
        <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
    printWin.document.close();
};

// ============================================================================
// API INFO MODAL
// ============================================================================

window.ptmShowApiInfo = function () {
    const fromDate = document.getElementById('ptm-date-from').value;
    const toDate = document.getElementById('ptm-date-to').value;

    const fullUrl = fromDate && toDate
        ? `${PTM_API}?FROM_DATE=${fromDate}&TO_DATE=${toDate}`
        : PTM_API + '?FROM_DATE=YYYY-MM-DD&TO_DATE=YYYY-MM-DD';

    const urlDisplay = document.getElementById('ptm-api-url-display');
    if (urlDisplay) urlDisplay.textContent = fullUrl;

    const fromDisplay = document.getElementById('ptm-api-from-display');
    if (fromDisplay) fromDisplay.textContent = fromDate || '(not set)';

    const toDisplay = document.getElementById('ptm-api-to-display');
    if (toDisplay) toDisplay.textContent = toDate || '(not set)';

    // Hide previous test result
    const result = document.getElementById('ptm-api-result');
    if (result) result.style.display = 'none';

    const modal = document.getElementById('ptm-api-modal');
    if (modal) modal.style.display = 'flex';
};

window.ptmCloseApiModal = function () {
    const modal = document.getElementById('ptm-api-modal');
    if (modal) modal.style.display = 'none';
};

window.ptmCopyApiUrl = function () {
    const fromDate = document.getElementById('ptm-date-from').value;
    const toDate = document.getElementById('ptm-date-to').value;
    const url = fromDate && toDate
        ? `${PTM_API}?FROM_DATE=${fromDate}&TO_DATE=${toDate}`
        : PTM_API;

    navigator.clipboard.writeText(url).then(function () {
        if (typeof DevExpress !== 'undefined') {
            DevExpress.ui.notify({ message: 'API URL copied to clipboard!', type: 'success', displayTime: 2000 });
        } else {
            if (typeof showNotification === 'function') showNotification('URL copied to clipboard!', 'success');
        }
    }).catch(function () {
        alert('URL: ' + url);
    });
};

window.ptmTestApi = function () {
    const fromDate = document.getElementById('ptm-date-from').value || new Date().toISOString().split('T')[0];
    const toDate   = document.getElementById('ptm-date-to').value   || new Date().toISOString().split('T')[0];
    const url = PTM_API + '?FROM_DATE=' + fromDate + '&TO_DATE=' + toDate;

    const resultDiv = document.getElementById('ptm-api-result');
    const resultBox = document.getElementById('ptm-api-result-box');
    const responseEl = document.getElementById('ptm-api-response');
    const iconEl  = document.getElementById('ptm-api-result-icon');
    const labelEl = document.getElementById('ptm-api-result-label');

    resultDiv.style.display = 'block';
    responseEl.textContent = 'Loading...';
    resultBox.style.background = '#f3f4f6';
    resultBox.style.borderColor = '#e5e7eb';
    iconEl.className = 'fas fa-spinner fa-spin';
    iconEl.style.color = '#667eea';
    labelEl.textContent = 'Testing...';

    function onSuccess(jsonData) {
        var count = jsonData && jsonData.data ? jsonData.data.length : 0;
        resultBox.style.background = '#f0fdf4';
        resultBox.style.borderColor = '#bbf7d0';
        iconEl.className = 'fas fa-check-circle';
        iconEl.style.color = '#10b981';
        labelEl.textContent = 'API Response (' + count + ' records)';
        responseEl.textContent = JSON.stringify(jsonData, null, 2);
    }

    function onError(msg) {
        resultBox.style.background = '#fef2f2';
        resultBox.style.borderColor = '#fecaca';
        iconEl.className = 'fas fa-times-circle';
        iconEl.style.color = '#ef4444';
        labelEl.textContent = 'API Error';
        responseEl.textContent = 'Error: ' + msg;
    }

    if (window.chrome && window.chrome.webview) {
        // Use C# REST handler to avoid CORS restrictions
        sendMessageToCSharp({ action: 'executeGet', fullUrl: url }, function (error, data) {
            if (error) {
                onError(error);
            } else {
                try {
                    var parsed = typeof data === 'string' ? JSON.parse(data) : data;
                    onSuccess(parsed);
                } catch (e) {
                    responseEl.textContent = 'Raw response:\n' + data;
                }
            }
        });
    } else {
        // Fallback for browser dev (CORS may block)
        fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (data) { onSuccess(data); })
            .catch(function (err) { onError(err.message + '\n\n(CORS may block direct browser access — use the app for full functionality.)'); });
    }
};

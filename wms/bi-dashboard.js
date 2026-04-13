// ============================================================================
// BI DASHBOARD
// Analytics / BI Dashboard — API connector, chart builder, data grid, export
// ============================================================================

const BI_STORAGE_KEY = 'bi_dashboard_configs';

let biData = [];           // raw fetched rows
let biColumns = [];        // column names
let biGridInstance = null; // DevExtreme grid
let biChartInstance = null;// Chart.js instance
let biInitialized = false;

// ============================================================================
// INIT
// ============================================================================

window.biDashboardInit = function() {
    if (biInitialized) return;
    biInitialized = true;
    biLog('BI Dashboard initialised');
    biRefreshSavedConfigs();
};

// ============================================================================
// SECTION TOGGLE
// ============================================================================

window.biToggleSection = function(bodyId, iconId) {
    const body = document.getElementById(bodyId);
    const icon = document.getElementById(iconId);
    if (!body) return;
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? '' : 'none';
    if (icon) icon.style.transform = isHidden ? '' : 'rotate(-90deg)';
};

// ============================================================================
// BASIC AUTH HELPERS
// ============================================================================

window.biToggleAuth = function(enabled) {
    const fields = document.getElementById('bi-auth-fields');
    if (fields) fields.style.display = enabled ? 'flex' : 'none';
};

window.biTogglePasswordVisibility = function() {
    const pwd = document.getElementById('bi-auth-password');
    const eye = document.getElementById('bi-pwd-eye');
    if (!pwd) return;
    const isHidden = pwd.type === 'password';
    pwd.type = isHidden ? 'text' : 'password';
    if (eye) eye.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
};

function biGetAuthCredentials() {
    const enabled = document.getElementById('bi-auth-enabled')?.checked;
    if (!enabled) return null;
    const username = document.getElementById('bi-auth-username')?.value?.trim();
    const password = document.getElementById('bi-auth-password')?.value;
    if (!username) return null;
    return { username, password: password || '' };
}

function biMakeAuthHeader(username, password) {
    return 'Basic ' + btoa(`${username}:${password}`);
}

// ============================================================================
// PARAM BUILDER
// ============================================================================

window.biAddParam = function(key, value) {
    const list = document.getElementById('bi-params-list');
    if (!list) return;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:0.4rem; align-items:center;';
    row.innerHTML = `
        <input type="text" placeholder="key" value="${key || ''}"
               style="flex:1; padding:5px 8px; border:1px solid #d1d5db; border-radius:5px; font-size:12px; font-family:monospace;" class="bi-param-key">
        <span style="color:#94a3b8; font-size:12px;">=</span>
        <input type="text" placeholder="value" value="${value || ''}"
               style="flex:2; padding:5px 8px; border:1px solid #d1d5db; border-radius:5px; font-size:12px; font-family:monospace;" class="bi-param-val">
        <button onclick="this.parentElement.remove()" style="background:#fee2e2; color:#ef4444; border:none; padding:4px 7px; border-radius:5px; cursor:pointer; font-size:11px;">
            <i class="fas fa-times"></i>
        </button>`;
    list.appendChild(row);
};

function biGetParams() {
    const params = {};
    document.querySelectorAll('#bi-params-list > div').forEach(row => {
        const k = row.querySelector('.bi-param-key')?.value?.trim();
        const v = row.querySelector('.bi-param-val')?.value?.trim();
        if (k) params[k] = v || '';
    });
    return params;
}

// ============================================================================
// SAVED CONFIGS
// ============================================================================

function biGetConfigs() {
    try { return JSON.parse(localStorage.getItem(BI_STORAGE_KEY) || '{}'); } catch { return {}; }
}

function biRefreshSavedConfigs() {
    const sel = document.getElementById('bi-saved-configs');
    if (!sel) return;
    const configs = biGetConfigs();
    sel.innerHTML = '<option value="">-- select saved config --</option>';
    Object.keys(configs).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
}

window.biLoadSavedConfig = function(name) {
    if (!name) return;
    const configs = biGetConfigs();
    const cfg = configs[name];
    if (!cfg) return;

    document.getElementById('bi-config-name').value = name;
    document.getElementById('bi-api-url').value = cfg.url || '';
    document.getElementById('bi-api-method').value = cfg.method || 'GET';
    document.getElementById('bi-data-path').value = cfg.dataPath || '';

    // Restore params
    document.getElementById('bi-params-list').innerHTML = '';
    if (cfg.params) {
        Object.entries(cfg.params).forEach(([k, v]) => biAddParam(k, v));
    }

    // Restore auth
    const authEnabled = document.getElementById('bi-auth-enabled');
    if (authEnabled) {
        authEnabled.checked = !!cfg.authEnabled;
        biToggleAuth(!!cfg.authEnabled);
    }
    if (cfg.authEnabled) {
        const u = document.getElementById('bi-auth-username');
        const p = document.getElementById('bi-auth-password');
        if (u) u.value = cfg.authUsername || '';
        if (p) p.value = cfg.authPassword || '';
    }

    biLog(`Loaded config: ${name}`);
};

window.biSaveConfig = function() {
    const name = document.getElementById('bi-config-name')?.value?.trim();
    if (!name) { alert('Enter a config name first.'); return; }

    const authEnabled = document.getElementById('bi-auth-enabled')?.checked || false;
    const cfg = {
        url: document.getElementById('bi-api-url')?.value?.trim(),
        method: document.getElementById('bi-api-method')?.value,
        dataPath: document.getElementById('bi-data-path')?.value?.trim(),
        params: biGetParams(),
        authEnabled,
        authUsername: authEnabled ? (document.getElementById('bi-auth-username')?.value?.trim() || '') : '',
        authPassword: authEnabled ? (document.getElementById('bi-auth-password')?.value || '') : ''
    };

    const configs = biGetConfigs();
    configs[name] = cfg;
    localStorage.setItem(BI_STORAGE_KEY, JSON.stringify(configs));
    biRefreshSavedConfigs();
    document.getElementById('bi-saved-configs').value = name;
    biLog(`Saved config: ${name}`, 'success');
};

window.biDeleteConfig = function() {
    const name = document.getElementById('bi-saved-configs')?.value;
    if (!name) { alert('Select a config to delete.'); return; }
    if (!confirm(`Delete config "${name}"?`)) return;

    const configs = biGetConfigs();
    delete configs[name];
    localStorage.setItem(BI_STORAGE_KEY, JSON.stringify(configs));
    biRefreshSavedConfigs();
    biLog(`Deleted config: ${name}`);
};

// ============================================================================
// FETCH DATA
// ============================================================================

window.biFetchData = async function() {
    const url = document.getElementById('bi-api-url')?.value?.trim();
    if (!url) { alert('Please enter an API URL.'); return; }

    const method   = document.getElementById('bi-api-method')?.value || 'GET';
    const dataPath = document.getElementById('bi-data-path')?.value?.trim();
    const params   = biGetParams();

    // Build full URL with query params for GET
    let fullUrl = url;
    if (method === 'GET' && Object.keys(params).length > 0) {
        const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        fullUrl = url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
    }

    const body = method === 'POST' && Object.keys(params).length > 0 ? JSON.stringify(params) : '{}';
    const auth = biGetAuthCredentials();

    biSetFetchState(true);
    biSetStatus('Fetching data...');
    biLog(`Fetching: ${method} ${fullUrl}${auth ? ' [Basic Auth]' : ''}`);

    try {
        let json;

        if (typeof sendMessageToCSharp === 'function') {
            const msg = { action: method === 'POST' ? 'executePost' : 'executeGet', fullUrl, body };
            if (auth) { msg.username = auth.username; msg.password = auth.password; }
            json = await new Promise((resolve, reject) => {
                sendMessageToCSharp(msg, (err, data) => {
                    if (err) return reject(err);
                    try {
                        resolve(typeof data === 'string' ? JSON.parse(data) : data);
                    } catch (e) { reject(e); }
                });
            });
        } else {
            const headers = { 'Content-Type': 'application/json' };
            if (auth) headers['Authorization'] = biMakeAuthHeader(auth.username, auth.password);
            const opts = { method, headers };
            if (method === 'POST') opts.body = body;
            const res = await fetch(fullUrl, opts);
            json = await res.json();
        }

        // Resolve data path
        let rows = json;
        if (dataPath) {
            dataPath.split('.').forEach(key => { if (rows && rows[key] !== undefined) rows = rows[key]; });
        }
        if (!Array.isArray(rows)) {
            // Try common root keys
            const keys = ['items', 'data', 'rows', 'results', 'records', 'result'];
            for (const k of keys) {
                if (Array.isArray(json[k])) { rows = json[k]; break; }
            }
        }
        if (!Array.isArray(rows)) rows = [json]; // wrap single object

        biData = rows;
        biLog(`Fetched ${rows.length} rows`, 'success');
        biSetStatus(`${rows.length} rows loaded`);
        biRenderAll();

    } catch (err) {
        biLog(`Fetch error: ${err.message}`, 'error');
        biSetStatus(`Error: ${err.message}`);
    } finally {
        biSetFetchState(false);
    }
};

function biSetFetchState(loading) {
    const btn  = document.getElementById('bi-fetch-btn');
    const icon = document.getElementById('bi-fetch-icon');
    if (btn)  btn.disabled = loading;
    if (icon) icon.className = loading ? 'fas fa-spinner fa-spin' : 'fas fa-download';
}

function biSetStatus(msg) {
    const el = document.getElementById('bi-fetch-status');
    if (el) el.textContent = msg;
}

// ============================================================================
// RENDER ALL
// ============================================================================

function biRenderAll() {
    if (!biData || biData.length === 0) {
        biShowEmpty(true);
        return;
    }

    biShowEmpty(false);
    biColumns = Object.keys(biData[0]);

    biRenderKPIs();
    biPopulateFieldSelectors();
    biRenderGrid();

    document.getElementById('bi-chart-section').style.display = '';
    document.getElementById('bi-grid-section').style.display = '';
}

// ============================================================================
// KPI CARDS
// ============================================================================

function biRenderKPIs() {
    const row = document.getElementById('bi-kpi-row');
    if (!row) return;

    // Find numeric columns
    const numericCols = biColumns.filter(col => {
        const sample = biData.find(r => r[col] !== null && r[col] !== undefined && r[col] !== '');
        return sample && !isNaN(parseFloat(sample[col]));
    });

    if (numericCols.length === 0) {
        // Just show row count
        row.innerHTML = biKpiCard('Total Rows', biData.length, '#667eea', '#764ba2', 'fa-list');
        row.style.display = 'flex';
        return;
    }

    let html = biKpiCard('Total Rows', biData.length, '#667eea', '#764ba2', 'fa-list');
    numericCols.slice(0, 5).forEach(col => {
        const sum = biData.reduce((acc, r) => acc + (parseFloat(r[col]) || 0), 0);
        const label = col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const color1 = biKpiColor(col, 0);
        const color2 = biKpiColor(col, 1);
        html += biKpiCard(`Total ${label}`, biFormatNum(sum), color1, color2, 'fa-sigma');
    });

    row.innerHTML = html;
    row.style.display = 'flex';
}

function biKpiCard(label, value, c1, c2, icon) {
    return `<div style="background: linear-gradient(135deg, ${c1} 0%, ${c2} 100%); padding: 0.6rem 1.1rem; border-radius: 8px; min-width: 140px;">
        <div style="font-size: 18px; font-weight: 700; color: white;">${value}</div>
        <div style="font-size: 10px; color: rgba(255,255,255,0.9); font-weight: 600; margin-top: 2px;">
            <i class="fas ${icon}"></i> ${label}
        </div>
    </div>`;
}

const BI_KPI_COLORS = [
    ['#3b82f6','#1d4ed8'], ['#10b981','#059669'], ['#f59e0b','#d97706'],
    ['#ef4444','#dc2626'], ['#8b5cf6','#7c3aed']
];
function biKpiColor(col, idx) { return BI_KPI_COLORS[Math.abs(col.charCodeAt(0) % 5)][idx]; }

function biFormatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return parseFloat(n.toFixed(3)).toString();
}

// ============================================================================
// FIELD SELECTORS
// ============================================================================

function biPopulateFieldSelectors() {
    const xSel = document.getElementById('bi-x-field');
    const ySel = document.getElementById('bi-y-field');
    if (!xSel || !ySel) return;

    const options = biColumns.map(c => `<option value="${c}">${c}</option>`).join('');
    xSel.innerHTML = options;
    ySel.innerHTML = options;

    // Default: first col as X, first numeric as Y
    const numericCol = biColumns.find(col => {
        const s = biData.find(r => r[col] !== null && r[col] !== undefined && r[col] !== '');
        return s && !isNaN(parseFloat(s[col]));
    });
    if (numericCol) ySel.value = numericCol;
}

// ============================================================================
// CHART BUILDER
// ============================================================================

window.biRenderChart = function() {
    const xField = document.getElementById('bi-x-field')?.value;
    const yField = document.getElementById('bi-y-field')?.value;
    const chartType = document.getElementById('bi-chart-type')?.value || 'bar';
    const aggregation = document.getElementById('bi-aggregation')?.value || 'none';

    if (!xField || !yField) { alert('Select X and Y fields.'); return; }
    if (!biData || biData.length === 0) { alert('No data loaded.'); return; }

    // Aggregate data
    let labels = [];
    let values = [];

    if (aggregation === 'none') {
        labels = biData.map(r => String(r[xField] ?? ''));
        values = biData.map(r => parseFloat(r[yField]) || 0);
    } else {
        const groups = {};
        biData.forEach(row => {
            const key = String(row[xField] ?? '');
            const val = parseFloat(row[yField]) || 0;
            if (!groups[key]) groups[key] = { sum: 0, count: 0, max: -Infinity, min: Infinity, vals: [] };
            groups[key].sum   += val;
            groups[key].count += 1;
            groups[key].max    = Math.max(groups[key].max, val);
            groups[key].min    = Math.min(groups[key].min, val);
            groups[key].vals.push(val);
        });
        labels = Object.keys(groups);
        values = labels.map(k => {
            const g = groups[k];
            switch (aggregation) {
                case 'sum':   return g.sum;
                case 'count': return g.count;
                case 'avg':   return g.sum / g.count;
                case 'max':   return g.max;
                case 'min':   return g.min;
                default:      return g.sum;
            }
        });
    }

    // Destroy previous chart
    if (biChartInstance) { biChartInstance.destroy(); biChartInstance = null; }

    const container = document.getElementById('bi-chart-container');
    const canvas    = document.getElementById('bi-chart-canvas');
    if (!container || !canvas) return;
    container.style.display = 'block';

    const isPie = chartType === 'pie' || chartType === 'doughnut';
    const palette = ['#667eea','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
    const bgColors = isPie
        ? labels.map((_, i) => palette[i % palette.length])
        : palette[0];

    const isHBar = chartType === 'horizontalBar';
    const type = isHBar ? 'bar' : chartType;

    biChartInstance = new Chart(canvas, {
        type,
        data: {
            labels,
            datasets: [{
                label: `${aggregation !== 'none' ? aggregation.toUpperCase() + ' of ' : ''}${yField}`,
                data: values,
                backgroundColor: bgColors,
                borderColor: isPie ? 'white' : palette[0],
                borderWidth: isPie ? 2 : 1,
                tension: 0.3
            }]
        },
        options: {
            indexAxis: isHBar ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: isPie, position: 'right' },
                title: {
                    display: true,
                    text: `${yField} by ${xField}${aggregation !== 'none' ? ' (' + aggregation + ')' : ''}`,
                    font: { size: 13 }
                }
            },
            scales: isPie ? {} : {
                y: { beginAtZero: true, ticks: { font: { size: 11 } } },
                x: { ticks: { font: { size: 11 }, maxRotation: 45 } }
            }
        }
    });

    biLog(`Chart rendered: ${chartType} — ${xField} vs ${yField} (${aggregation})`);
};

window.biClearChart = function() {
    if (biChartInstance) { biChartInstance.destroy(); biChartInstance = null; }
    const container = document.getElementById('bi-chart-container');
    if (container) container.style.display = 'none';
};

// ============================================================================
// DATA GRID
// ============================================================================

function biRenderGrid() {
    const container = document.getElementById('bi-grid');
    if (!container) return;

    // Update row count badge
    const badge = document.getElementById('bi-row-count');
    if (badge) badge.textContent = `${biData.length} rows`;

    // Build columns config
    const columns = biColumns.map(col => ({
        dataField: col,
        caption: col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        minWidth: 100
    }));

    if (biGridInstance) {
        biGridInstance.option('dataSource', [...biData]);
        biGridInstance.option('columns', columns);
        biGridInstance.refresh();
        return;
    }

    if (typeof DevExpress !== 'undefined') {
        biGridInstance = $('#bi-grid').dxDataGrid({
            dataSource: biData,
            columns,
            showBorders: true,
            showRowLines: true,
            showColumnLines: true,
            rowAlternationEnabled: true,
            allowColumnResizing: true,
            allowColumnReordering: true,
            columnAutoWidth: true,
            scrolling: { mode: 'virtual' },
            paging: { pageSize: 50 },
            pager: { showPageSizeSelector: true, allowedPageSizes: [20, 50, 100, 'all'], showInfo: true },
            searchPanel: { visible: true, width: 200, placeholder: 'Search...' },
            filterRow: { visible: true },
            headerFilter: { visible: true },
            groupPanel: { visible: true },
            export: { enabled: false },
            selection: { mode: 'multiple', showCheckBoxesMode: 'always' }
        }).dxDataGrid('instance');
    } else {
        // Fallback plain table
        biRenderFallbackTable(container);
    }
}

function biRenderFallbackTable(container) {
    const headers = biColumns.map(c => `<th style="padding:0.5rem 0.75rem; background:#f8fafc; border-bottom:2px solid #e2e8f0; font-size:12px; white-space:nowrap;">${c}</th>`).join('');
    const rows = biData.slice(0, 500).map(row =>
        `<tr>${biColumns.map(c => `<td style="padding:0.4rem 0.75rem; font-size:12px; border-bottom:1px solid #f1f5f9;">${row[c] ?? ''}</td>`).join('')}</tr>`
    ).join('');
    container.innerHTML = `<div style="overflow:auto; max-height:500px;"><table style="width:100%; border-collapse:collapse;">${headers}${rows}</table></div>`;
}

// ============================================================================
// EXPORT TO EXCEL
// ============================================================================

window.biExportExcel = function() {
    if (!biData || biData.length === 0) { alert('No data to export.'); return; }
    if (typeof ExcelJS === 'undefined') { alert('ExcelJS not loaded.'); return; }

    const workbook  = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('BI Dashboard');

    worksheet.columns = biColumns.map(col => ({
        header: col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        key: col,
        width: 16
    }));

    // Header style
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF667eea' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    biData.forEach(item => {
        const row = {};
        biColumns.forEach(col => { row[col] = item[col] ?? ''; });
        worksheet.addRow(row);
    });

    worksheet.eachRow(row => {
        row.eachCell(cell => {
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
    });

    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    workbook.xlsx.writeBuffer().then(buffer => {
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, `BI_Dashboard_${ts}.xlsx`);
        biLog(`Exported ${biData.length} rows`, 'success');
    });
};

// ============================================================================
// CLEAR
// ============================================================================

window.biClearData = function() {
    biData = [];
    biColumns = [];
    biClearChart();
    if (biGridInstance) { biGridInstance.option('dataSource', []); }
    const kpiRow = document.getElementById('bi-kpi-row');
    if (kpiRow) { kpiRow.style.display = 'none'; kpiRow.innerHTML = ''; }
    document.getElementById('bi-chart-section').style.display  = 'none';
    document.getElementById('bi-grid-section').style.display   = 'none';
    biShowEmpty(true);
    biSetStatus('');
    biLog('Data cleared');
};

function biShowEmpty(show) {
    const el = document.getElementById('bi-empty-state');
    if (el) el.style.display = show ? 'block' : 'none';
}

// ============================================================================
// LOGGING
// ============================================================================

function biLog(msg, level) {
    const prefix = '[BI Dashboard]';
    if (level === 'error') console.error(`${prefix} ${msg}`);
    else if (level === 'success') console.log(`%c${prefix} ${msg}`, 'color:#10b981');
    else console.log(`${prefix} ${msg}`);
}

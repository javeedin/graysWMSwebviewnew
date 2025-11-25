// ============================================================================
// PENDING STORE TRANSACTIONS
// ============================================================================
// View and manage pending S2V transactions with DevExpress Grid
// ============================================================================

// Global state
let pstData = [];
let pstSelectedRows = new Set();
let pstGridInstance = null;
let pstDebugEnabled = false;

// Initialize page on load
document.addEventListener('DOMContentLoaded', function() {
    initializePendingStoreTransactions();

    // Set page title in toolbar when this page is shown
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            const pageId = this.getAttribute('data-page');
            if (pageId === 'pending-store-transactions') {
                const pageTitleElement = document.getElementById('current-page-title');
                if (pageTitleElement) {
                    pageTitleElement.textContent = 'Pending Transactions';
                }
            }
        });
    });
});

// Debug logging
function pstLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;

    console.log(`[PST] ${message}`);

    // Add to debug panel
    const debugLog = document.getElementById('pst-debug-log');
    if (debugLog) {
        const color = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : type === 'warn' ? '#f59e0b' : '#94a3b8';
        debugLog.innerHTML += `<div style="color: ${color}; margin-bottom: 2px;">${logMessage}</div>`;
        debugLog.scrollTop = debugLog.scrollHeight;
    }
}

// Toggle debug panel
function togglePstDebug() {
    const panel = document.getElementById('pst-debug-panel');
    if (panel) {
        pstDebugEnabled = panel.style.display === 'none';
        panel.style.display = pstDebugEnabled ? 'block' : 'none';
        if (pstDebugEnabled) {
            pstLog('Debug panel enabled', 'info');
        }
    }
}

// Initialize the page
function initializePendingStoreTransactions() {
    // Set default dates (today)
    const today = new Date().toISOString().split('T')[0];
    const fromDateEl = document.getElementById('pst-from-date');
    const toDateEl = document.getElementById('pst-to-date');

    if (fromDateEl) fromDateEl.value = today;
    if (toDateEl) toDateEl.value = today;

    // Initialize empty grid
    initializePstGrid([]);

    pstLog('Page initialized', 'success');
}

// Fetch pending store transactions from API
function fetchPendingStoreTransactions() {
    const sourceOrg = document.getElementById('pst-source-org')?.value || 'GIC';
    const fromDate = document.getElementById('pst-from-date')?.value;
    const toDate = document.getElementById('pst-to-date')?.value;

    if (!fromDate || !toDate) {
        alert('Please select both From Date and To Date');
        return;
    }

    // Show debug panel automatically on fetch
    const debugPanel = document.getElementById('pst-debug-panel');
    if (debugPanel) debugPanel.style.display = 'block';

    // Show loading state
    const fetchIcon = document.getElementById('pst-fetch-icon');
    if (fetchIcon) fetchIcon.className = 'fas fa-spinner fa-spin';

    const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/PendingS2Vtransactions?P_SOURCE_ORG=${sourceOrg}&P_FROM_DATE=${fromDate}&P_TO_DATE=${toDate}`;

    pstLog(`Fetching data...`, 'info');
    pstLog(`Source Org: ${sourceOrg}`, 'info');
    pstLog(`Date Range: ${fromDate} to ${toDate}`, 'info');
    pstLog(`API URL: ${apiUrl}`, 'info');

    // Check if sendMessageToCSharp is available
    if (typeof sendMessageToCSharp !== 'function') {
        pstLog('ERROR: sendMessageToCSharp function not available!', 'error');
        pstLog('Trying alternative WebView method...', 'warn');
        fetchPendingStoreTransactionsAlt(apiUrl);
        return;
    }

    pstLog('Using sendMessageToCSharp...', 'info');

    sendMessageToCSharp({
        action: "executeGet",
        fullUrl: apiUrl
    }, function(error, data) {
        // Reset icon
        if (fetchIcon) fetchIcon.className = 'fas fa-search';

        if (error) {
            pstLog(`Error: ${error}`, 'error');
            alert('Error fetching data: ' + error);
            return;
        }

        pstLog('Response received!', 'success');
        processApiResponse(data);
    });
}

// Alternative fetch method using WebView directly
function fetchPendingStoreTransactionsAlt(apiUrl) {
    pstLog('Using alternative WebView postMessage...', 'info');

    if (!window.chrome?.webview) {
        pstLog('ERROR: WebView not available!', 'error');
        const fetchIcon = document.getElementById('pst-fetch-icon');
        if (fetchIcon) fetchIcon.className = 'fas fa-search';
        return;
    }

    const callbackId = 'pst-fetch-' + Date.now();
    pstLog(`Callback ID: ${callbackId}`, 'info');

    const timeout = setTimeout(() => {
        pstLog('Request timeout after 30 seconds!', 'error');
        const fetchIcon = document.getElementById('pst-fetch-icon');
        if (fetchIcon) fetchIcon.className = 'fas fa-search';
    }, 30000);

    const handleResponse = (event) => {
        const data = event.data;
        pstLog(`Message received: ${JSON.stringify(data).substring(0, 100)}...`, 'info');

        if (data.callbackId === callbackId || data.requestId === callbackId) {
            clearTimeout(timeout);
            window.chrome.webview.removeEventListener('message', handleResponse);

            const fetchIcon = document.getElementById('pst-fetch-icon');
            if (fetchIcon) fetchIcon.className = 'fas fa-search';

            pstLog('Matched response received!', 'success');
            processApiResponse(data.data || data.response || data);
        }
    };

    window.chrome.webview.addEventListener('message', handleResponse);

    window.chrome.webview.postMessage({
        type: 'REST_API_CALL',
        action: 'executeGet',
        url: apiUrl,
        fullUrl: apiUrl,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        callbackId: callbackId,
        requestId: callbackId
    });

    pstLog('Message posted to WebView', 'info');
}

// Process API response
function processApiResponse(data) {
    try {
        let responseData = data;

        if (typeof responseData === 'string') {
            pstLog('Parsing string response...', 'info');
            responseData = responseData.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
            responseData = JSON.parse(responseData);
        }

        pstLog(`Response keys: ${Object.keys(responseData || {}).join(', ')}`, 'info');

        // Get items array
        if (responseData.items) {
            pstData = responseData.items;
            pstLog(`Found ${pstData.length} items in response.items`, 'success');
        } else if (Array.isArray(responseData)) {
            pstData = responseData;
            pstLog(`Found ${pstData.length} items (array)`, 'success');
        } else {
            pstData = [];
            pstLog('No items found in response', 'warn');
            pstLog(`Response: ${JSON.stringify(responseData).substring(0, 300)}`, 'info');
        }

        // Log first row to see actual fields
        if (pstData.length > 0) {
            pstLog(`Fields: ${Object.keys(pstData[0]).join(', ')}`, 'info');
            pstLog(`First row: ${JSON.stringify(pstData[0])}`, 'info');
        }

        pstSelectedRows.clear();
        updatePstKpiCards();
        initializePstGrid(pstData);

        const lastFetch = document.getElementById('pst-last-fetch');
        if (lastFetch) {
            lastFetch.textContent = 'Last fetched: ' + new Date().toLocaleTimeString();
        }

    } catch (e) {
        pstLog(`Parse error: ${e.message}`, 'error');
        console.error('[PST] Parse error:', e);
        alert('Error parsing response data: ' + e.message);
    }
}

// Update KPI cards
function updatePstKpiCards() {
    // Total Lines
    const totalLines = document.getElementById('pst-total-lines');
    if (totalLines) totalLines.textContent = pstData.length;

    // Total Orders (distinct trx_number)
    const distinctOrders = [...new Set(pstData.map(t => t.trx_number).filter(Boolean))];
    const totalOrders = document.getElementById('pst-total-orders');
    if (totalOrders) totalOrders.textContent = distinctOrders.length;

    // Selected count
    const selectedCount = document.getElementById('pst-selected-count');
    if (selectedCount) selectedCount.textContent = pstSelectedRows.size;

    pstLog(`KPI: ${distinctOrders.length} orders, ${pstData.length} lines`, 'info');
}

// Initialize DevExpress Grid - use actual columns from API
function initializePstGrid(data) {
    const container = document.getElementById('pst-grid-container');
    if (!container) {
        pstLog('Grid container not found!', 'error');
        return;
    }

    // Check if DevExtreme is available
    if (typeof DevExpress === 'undefined' || !DevExpress.ui?.dxDataGrid) {
        pstLog('DevExtreme not available, using fallback table', 'warn');
        renderFallbackTable(data);
        return;
    }

    pstLog('Initializing DevExpress Grid...', 'info');

    // Destroy existing grid instance
    if (pstGridInstance) {
        pstGridInstance.dispose();
        pstGridInstance = null;
    }

    // Add row index for selection
    data.forEach((item, idx) => { item._rowIndex = idx; });

    try {
        // Create DevExpress DataGrid with actual columns from API
        // Columns: trx_number, trx_date, trx_type, source_org_code, source_sub_inv, dest_org_code, dest_sub_inv, total_items, transaction_status
        pstGridInstance = new DevExpress.ui.dxDataGrid(container, {
            dataSource: data,
            keyExpr: '_rowIndex',
            showBorders: true,
            showRowLines: true,
            rowAlternationEnabled: true,
            allowColumnResizing: true,
            columnAutoWidth: true,
            height: '100%',
            selection: {
                mode: 'multiple',
                showCheckBoxesMode: 'always'
            },
            onSelectionChanged: function(e) {
                pstSelectedRows = new Set(e.selectedRowKeys);
                const selectedCount = document.getElementById('pst-selected-count');
                if (selectedCount) selectedCount.textContent = pstSelectedRows.size;
            },
            paging: { pageSize: 50 },
            pager: {
                showPageSizeSelector: true,
                allowedPageSizes: [25, 50, 100, 200],
                showInfo: true
            },
            filterRow: { visible: true },
            headerFilter: { visible: true },
            searchPanel: { visible: true, width: 240, placeholder: 'Search...' },
            columns: [
                {
                    dataField: 'trx_number',
                    caption: 'Order #',
                    width: 130,
                    cellTemplate: function(cellElement, cellInfo) {
                        const trxNumber = cellInfo.value || '';
                        const rowData = cellInfo.data;
                        const html = `<a href="javascript:void(0)" onclick="openStoreTransactionsFromPst(pstData[${rowData._rowIndex}])" style="color: #667eea; text-decoration: none; font-weight: 600; cursor: pointer;">${trxNumber}</a>`;
                        $(cellElement).append(html);
                    }
                },
                { dataField: 'trx_date', caption: 'Date', width: 100 },
                { dataField: 'trx_type', caption: 'Type', width: 100 },
                { dataField: 'source_org_code', caption: 'Source Org', width: 100 },
                { dataField: 'source_sub_inv', caption: 'From', width: 100 },
                { dataField: 'dest_org_code', caption: 'Dest Org', width: 100 },
                { dataField: 'dest_sub_inv', caption: 'To', width: 100 },
                { dataField: 'total_items', caption: 'Items', width: 70, dataType: 'number', alignment: 'center' },
                { dataField: 'transaction_status', caption: 'Status', width: 100 },
                {
                    caption: 'Actions',
                    width: 120,
                    alignment: 'center',
                    cellTemplate: function(cellElement, cellInfo) {
                        const rowData = cellInfo.data;
                        const html = `
                            <div style="display: flex; gap: 4px; justify-content: center;">
                                <button onclick="addSingleToTrip(pstData[${rowData._rowIndex}])" style="background: #10b981; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px;" title="Add to Trip">
                                    <i class="fas fa-plus"></i>
                                </button>
                                <button onclick="editPstTransaction(pstData[${rowData._rowIndex}])" style="background: #667eea; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px;" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </button>
                            </div>
                        `;
                        $(cellElement).append(html);
                    }
                }
            ],
            onContentReady: function(e) {
                pstLog('Grid rendered successfully', 'success');
            }
        });
    } catch (e) {
        pstLog(`Grid error: ${e.message}`, 'error');
        renderFallbackTable(data);
    }
}

// Fallback HTML table - display whatever fields are in data
function renderFallbackTable(data) {
    const container = document.getElementById('pst-grid-container');
    if (!container) return;

    if (data.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: #94a3b8;">
                <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 1rem;"></i>
                <p style="font-size: 16px; margin: 0;">No data loaded. Click "Fetch Data" to begin.</p>
            </div>
        `;
        return;
    }

    // Build table from actual data fields
    let html = `
        <div style="overflow-x: auto; max-height: 500px; overflow-y: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                <thead style="position: sticky; top: 0; background: linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%);">
                    <tr>
                        <th style="padding: 0.6rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 40px;">
                            <input type="checkbox" id="pst-select-all" onchange="toggleAllPstCheckboxes(this.checked)">
                        </th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Order #</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Date</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Type</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Source Org</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">From</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Dest Org</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">To</th>
                        <th style="padding: 0.6rem; text-align: center; border-bottom: 2px solid #e2e8f0;">Items</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Status</th>
                        <th style="padding: 0.6rem; text-align: center; border-bottom: 2px solid #e2e8f0;">Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    data.forEach((item, index) => {
        const rowBg = index % 2 === 0 ? '#ffffff' : '#f8fafc';

        html += `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 0.5rem; text-align: center;">
                    <input type="checkbox" class="pst-row-checkbox" data-index="${index}" onchange="togglePstRowSelection('${index}', this.checked)">
                </td>
                <td style="padding: 0.5rem;"><a href="javascript:void(0)" onclick="openStoreTransactionsFromPst(pstData[${index}])" style="color: #667eea; text-decoration: none; font-weight: 600; cursor: pointer;">${item.trx_number || ''}</a></td>
                <td style="padding: 0.5rem; color: #475569;">${item.trx_date || ''}</td>
                <td style="padding: 0.5rem; color: #475569;">${item.trx_type || ''}</td>
                <td style="padding: 0.5rem; color: #667eea;">${item.source_org_code || ''}</td>
                <td style="padding: 0.5rem; color: #475569;">${item.source_sub_inv || ''}</td>
                <td style="padding: 0.5rem; color: #667eea;">${item.dest_org_code || ''}</td>
                <td style="padding: 0.5rem; color: #475569;">${item.dest_sub_inv || ''}</td>
                <td style="padding: 0.5rem; text-align: center; font-weight: 700; color: #1e293b;">${item.total_items || 0}</td>
                <td style="padding: 0.5rem; color: #475569;">${item.transaction_status || ''}</td>
                <td style="padding: 0.5rem; text-align: center;">
                    <button onclick="addSingleToTrip(pstData[${index}])" style="background: #10b981; color: white; border: none; padding: 3px 6px; border-radius: 4px; cursor: pointer; font-size: 10px; margin-right: 4px;" title="Add to Trip">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button onclick="editPstTransaction(pstData[${index}])" style="background: #667eea; color: white; border: none; padding: 3px 6px; border-radius: 4px; cursor: pointer; font-size: 10px;" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;

    pstLog(`Table rendered with ${data.length} rows`, 'success');
}

// Toggle all checkboxes
function toggleAllPstCheckboxes(checked) {
    const checkboxes = document.querySelectorAll('.pst-row-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checked;
        const idx = cb.getAttribute('data-index');
        if (checked) {
            pstSelectedRows.add(idx);
        } else {
            pstSelectedRows.delete(idx);
        }
    });
    const selectedCount = document.getElementById('pst-selected-count');
    if (selectedCount) selectedCount.textContent = pstSelectedRows.size;
}

// Toggle single row selection
function togglePstRowSelection(idx, checked) {
    if (checked) {
        pstSelectedRows.add(idx);
    } else {
        pstSelectedRows.delete(idx);
    }
    const selectedCount = document.getElementById('pst-selected-count');
    if (selectedCount) selectedCount.textContent = pstSelectedRows.size;
}

// Select all rows
function selectAllPstRows() {
    if (pstGridInstance) {
        pstGridInstance.selectAll();
    } else {
        toggleAllPstCheckboxes(true);
        const selectAllCb = document.getElementById('pst-select-all');
        if (selectAllCb) selectAllCb.checked = true;
    }
}

// Deselect all rows
function deselectAllPstRows() {
    if (pstGridInstance) {
        pstGridInstance.deselectAll();
    } else {
        toggleAllPstCheckboxes(false);
        const selectAllCb = document.getElementById('pst-select-all');
        if (selectAllCb) selectAllCb.checked = false;
    }
}

// Add single row to trip
function addSingleToTrip(rowData) {
    pstLog(`Adding to trip: ${rowData.trx_number}`, 'info');
    alert('Add to Trip: ' + rowData.trx_number);
}

// Add selected rows to trip
function addSelectedToTrip() {
    if (pstSelectedRows.size === 0) {
        alert('Please select at least one row to add to trip');
        return;
    }

    const selectedIndices = Array.from(pstSelectedRows);
    const selectedData = selectedIndices.map(idx => pstData[parseInt(idx)]).filter(Boolean);

    pstLog(`Adding ${selectedData.length} items to trip`, 'info');
    alert('Adding ' + selectedData.length + ' item(s) to trip');
}

// Edit transaction
function editPstTransaction(rowData) {
    pstLog(`Editing: ${rowData.trx_number}`, 'info');
    alert('Edit: ' + rowData.trx_number);
}

// Open Store Transactions dialog for a pending transaction
function openStoreTransactionsFromPst(rowData) {
    pstLog(`Opening Store Transactions for: ${rowData.trx_number}`, 'info');

    // Map PST fields to the format expected by openStoreTransactionsDialog
    const mappedRowData = {
        ORDER_NUMBER: rowData.trx_number || '',
        order_number: rowData.trx_number || '',
        ORDER_TYPE: rowData.trx_type || 'Store to Van',
        order_type: rowData.trx_type || 'Store to Van',
        TRIP_DATE: rowData.trx_date || '',
        trip_date: rowData.trx_date || '',
        INSTANCE_NAME: rowData.source_org_code || 'PROD',
        instance_name: rowData.source_org_code || 'PROD',
        SOURCE_ORG_CODE: rowData.source_org_code || '',
        source_org_code: rowData.source_org_code || '',
        SOURCE_SUB_INV: rowData.source_sub_inv || '',
        source_sub_inv: rowData.source_sub_inv || '',
        DEST_ORG_CODE: rowData.dest_org_code || '',
        dest_org_code: rowData.dest_org_code || '',
        DEST_SUB_INV: rowData.dest_sub_inv || '',
        dest_sub_inv: rowData.dest_sub_inv || '',
        TOTAL_ITEMS: rowData.total_items || 0,
        total_items: rowData.total_items || 0,
        TRANSACTION_STATUS: rowData.transaction_status || '',
        transaction_status: rowData.transaction_status || ''
    };

    // Call the existing openStoreTransactionsDialog function from app.js
    if (typeof window.openStoreTransactionsDialog === 'function') {
        window.openStoreTransactionsDialog(mappedRowData);
    } else {
        pstLog('openStoreTransactionsDialog function not found!', 'error');
        alert('Store Transactions dialog function not found. Please ensure app.js is loaded.');
    }
}

// Expose function globally
window.openStoreTransactionsFromPst = openStoreTransactionsFromPst;

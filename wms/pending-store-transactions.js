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

        // Try alternative method
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
        pstLog(`Raw data type: ${typeof data}`, 'info');

        try {
            let responseData = data;

            if (typeof responseData === 'string') {
                pstLog('Parsing string response...', 'info');
                // Fix potential JSON issues
                responseData = responseData.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                responseData = JSON.parse(responseData);
            }

            pstLog(`Response keys: ${Object.keys(responseData || {}).join(', ')}`, 'info');

            // Try different data structures
            if (responseData.items) {
                pstData = responseData.items;
                pstLog(`Found ${pstData.length} items in response.items`, 'success');
            } else if (Array.isArray(responseData)) {
                pstData = responseData;
                pstLog(`Found ${pstData.length} items (array)`, 'success');
            } else {
                pstData = [];
                pstLog('No items found in response', 'warn');
                pstLog(`Response preview: ${JSON.stringify(responseData).substring(0, 200)}...`, 'info');
            }

            // Clear selections
            pstSelectedRows.clear();

            // Update KPI cards
            updatePstKpiCards();

            // Refresh grid
            initializePstGrid(pstData);

            // Update last fetch time
            const lastFetch = document.getElementById('pst-last-fetch');
            if (lastFetch) {
                lastFetch.textContent = 'Last fetched: ' + new Date().toLocaleTimeString();
            }

        } catch (e) {
            pstLog(`Parse error: ${e.message}`, 'error');
            console.error('[PST] Parse error:', e);
            alert('Error parsing response data: ' + e.message);
        }
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

    // Setup timeout
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

            try {
                let responseData = data.data || data.response || data;
                if (typeof responseData === 'string') {
                    responseData = responseData.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                    responseData = JSON.parse(responseData);
                }

                pstData = responseData.items || responseData || [];
                pstLog(`Fetched ${pstData.length} records`, 'success');

                pstSelectedRows.clear();
                updatePstKpiCards();
                initializePstGrid(pstData);

                const lastFetch = document.getElementById('pst-last-fetch');
                if (lastFetch) {
                    lastFetch.textContent = 'Last fetched: ' + new Date().toLocaleTimeString();
                }
            } catch (e) {
                pstLog(`Parse error: ${e.message}`, 'error');
            }
        }
    };

    window.chrome.webview.addEventListener('message', handleResponse);

    // Try REST_API_CALL format
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

// Update KPI cards
function updatePstKpiCards() {
    // Total Lines
    const totalLines = document.getElementById('pst-total-lines');
    if (totalLines) totalLines.textContent = pstData.length;

    // Total Orders (distinct order numbers)
    const distinctOrders = [...new Set(pstData.map(t => t.TRX_NUMBER || t.trx_number).filter(Boolean))];
    const totalOrders = document.getElementById('pst-total-orders');
    if (totalOrders) totalOrders.textContent = distinctOrders.length;

    // Selected count
    const selectedCount = document.getElementById('pst-selected-count');
    if (selectedCount) selectedCount.textContent = pstSelectedRows.size;

    pstLog(`KPI: ${distinctOrders.length} orders, ${pstData.length} lines, ${pstSelectedRows.size} selected`, 'info');
}

// Initialize DevExpress Grid
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

    try {
        // Create DevExpress DataGrid
        pstGridInstance = new DevExpress.ui.dxDataGrid(container, {
            dataSource: data,
            keyExpr: 'LID',
            showBorders: true,
            showRowLines: true,
            rowAlternationEnabled: true,
            allowColumnResizing: true,
            columnAutoWidth: true,
            wordWrapEnabled: false,
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
            paging: {
                pageSize: 50
            },
            pager: {
                showPageSizeSelector: true,
                allowedPageSizes: [25, 50, 100, 200],
                showInfo: true
            },
            filterRow: {
                visible: true
            },
            headerFilter: {
                visible: true
            },
            searchPanel: {
                visible: true,
                width: 240,
                placeholder: 'Search...'
            },
            columns: [
                { dataField: 'TRX_NUMBER', caption: 'Order #', width: 120 },
                { dataField: 'LID', caption: 'LID', width: 80 },
                { dataField: 'ITEM_CODE', caption: 'Item Code', width: 120 },
                { dataField: 'ITEM_DESC', caption: 'Item Description', width: 250 },
                { dataField: 'PICKED_QTY', caption: 'Qty', width: 70, dataType: 'number', alignment: 'center' },
                { dataField: 'LOT_NUMBER', caption: 'Lot #', width: 100 },
                { dataField: 'SOURCE_SUB_INV', caption: 'From', width: 80 },
                { dataField: 'DEST_SUB_INV', caption: 'To', width: 80 },
                {
                    caption: 'Actions',
                    width: 120,
                    alignment: 'center',
                    cellTemplate: function(container, options) {
                        const rowData = options.data;
                        const actionDiv = document.createElement('div');
                        actionDiv.style.cssText = 'display: flex; gap: 4px; justify-content: center;';

                        const addBtn = document.createElement('button');
                        addBtn.innerHTML = '<i class="fas fa-plus"></i>';
                        addBtn.title = 'Add to Trip';
                        addBtn.style.cssText = 'background: #10b981; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px;';
                        addBtn.onclick = (e) => { e.stopPropagation(); addSingleToTrip(rowData); };

                        const editBtn = document.createElement('button');
                        editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                        editBtn.title = 'Edit';
                        editBtn.style.cssText = 'background: #667eea; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px;';
                        editBtn.onclick = (e) => { e.stopPropagation(); editPstTransaction(rowData); };

                        actionDiv.appendChild(addBtn);
                        actionDiv.appendChild(editBtn);
                        container.appendChild(actionDiv);
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

// Fallback HTML table if DevExtreme not available
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

    let html = `
        <div style="overflow-x: auto; max-height: 500px; overflow-y: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                <thead style="position: sticky; top: 0; background: linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%);">
                    <tr>
                        <th style="padding: 0.6rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 40px;">
                            <input type="checkbox" id="pst-select-all" onchange="toggleAllPstCheckboxes(this.checked)">
                        </th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Order #</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">LID</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Item Code</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Item Description</th>
                        <th style="padding: 0.6rem; text-align: center; border-bottom: 2px solid #e2e8f0;">Qty</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Lot #</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">From</th>
                        <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">To</th>
                        <th style="padding: 0.6rem; text-align: center; border-bottom: 2px solid #e2e8f0;">Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    data.forEach((item, index) => {
        const rowBg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
        const lid = item.LID || item.lid || '';
        const trxNumber = item.TRX_NUMBER || item.trx_number || '';
        const itemCode = item.ITEM_CODE || item.item_code || '';
        const itemDesc = item.ITEM_DESC || item.item_desc || '';
        const qty = item.PICKED_QTY || item.picked_qty || 0;
        const lotNumber = item.LOT_NUMBER || item.lot_number || '';
        const sourceSubInv = item.SOURCE_SUB_INV || item.source_sub_inv || '';
        const destSubInv = item.DEST_SUB_INV || item.dest_sub_inv || '';

        html += `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 0.5rem; text-align: center;">
                    <input type="checkbox" class="pst-row-checkbox" data-lid="${lid}" onchange="togglePstRowSelection('${lid}', this.checked)">
                </td>
                <td style="padding: 0.5rem; font-weight: 600; color: #1e293b;">${trxNumber}</td>
                <td style="padding: 0.5rem; color: #667eea; font-weight: 600;">${lid}</td>
                <td style="padding: 0.5rem; color: #667eea;">${itemCode}</td>
                <td style="padding: 0.5rem; color: #475569; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${itemDesc}">${itemDesc}</td>
                <td style="padding: 0.5rem; text-align: center; font-weight: 700; color: #1e293b;">${qty}</td>
                <td style="padding: 0.5rem; color: #475569;">${lotNumber}</td>
                <td style="padding: 0.5rem; color: #475569;">${sourceSubInv}</td>
                <td style="padding: 0.5rem; color: #475569;">${destSubInv}</td>
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

    pstLog(`Fallback table rendered with ${data.length} rows`, 'success');
}

// Toggle all checkboxes
function toggleAllPstCheckboxes(checked) {
    const checkboxes = document.querySelectorAll('.pst-row-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checked;
        const lid = cb.getAttribute('data-lid');
        if (checked) {
            pstSelectedRows.add(lid);
        } else {
            pstSelectedRows.delete(lid);
        }
    });
    const selectedCount = document.getElementById('pst-selected-count');
    if (selectedCount) selectedCount.textContent = pstSelectedRows.size;
}

// Toggle single row selection
function togglePstRowSelection(lid, checked) {
    if (checked) {
        pstSelectedRows.add(lid);
    } else {
        pstSelectedRows.delete(lid);
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
    pstLog(`Adding to trip: ${rowData.TRX_NUMBER || rowData.trx_number} - LID: ${rowData.LID || rowData.lid}`, 'info');
    // TODO: Implement add to trip modal/functionality
    alert('Add to Trip: ' + (rowData.TRX_NUMBER || rowData.trx_number) + ' - LID: ' + (rowData.LID || rowData.lid));
}

// Add selected rows to trip
function addSelectedToTrip() {
    if (pstSelectedRows.size === 0) {
        alert('Please select at least one row to add to trip');
        return;
    }

    const selectedLids = Array.from(pstSelectedRows);
    const selectedData = pstData.filter(item =>
        selectedLids.includes(String(item.LID || item.lid))
    );

    pstLog(`Adding ${selectedData.length} items to trip`, 'info');
    // TODO: Implement add to trip modal/functionality
    alert('Adding ' + selectedData.length + ' item(s) to trip');
}

// Edit transaction
function editPstTransaction(rowData) {
    pstLog(`Editing: ${rowData.TRX_NUMBER || rowData.trx_number} - LID: ${rowData.LID || rowData.lid}`, 'info');
    // TODO: Implement edit modal/functionality
    alert('Edit: ' + (rowData.TRX_NUMBER || rowData.trx_number) + ' - LID: ' + (rowData.LID || rowData.lid));
}

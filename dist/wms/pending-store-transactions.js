// ============================================================================
// PENDING STORE TRANSACTIONS
// ============================================================================
// View and manage pending S2V transactions with DevExpress Grid
// ============================================================================

// Global state
let pstData = [];
let pstSelectedRows = new Set();
let pstGridInstance = null;

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

// Console logging
function pstLog(message, type = 'info') {
    console.log(`[PST] ${message}`);
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
    const instanceName = window.currentTripInstance || localStorage.getItem('fusionInstance') || 'PROD';

    if (!fromDate || !toDate) {
        alert('Please select both From Date and To Date');
        return;
    }

    // Show loading state
    const fetchIcon = document.getElementById('pst-fetch-icon');
    if (fetchIcon) fetchIcon.className = 'fas fa-spinner fa-spin';

    const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/PendingS2Vtransactions?P_SOURCE_ORG=${sourceOrg}&P_FROM_DATE=${fromDate}&P_TO_DATE=${toDate}&P_INSTANCE_NAME=${instanceName}`;

    pstLog(`Fetching: ${sourceOrg}, ${fromDate} to ${toDate}, instance: ${instanceName}`);

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
        INSTANCE_NAME: rowData.source_org_code || window.currentTripInstance || localStorage.getItem('fusionInstance') || 'TEST',
        instance_name: rowData.source_org_code || window.currentTripInstance || localStorage.getItem('fusionInstance') || 'TEST',
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

// ============================================================================
// ASSIGN PICKER FOR PST
// ============================================================================

// Assign Picker to selected orders
function assignPickerForPst() {
    pstLog('Assign Picker clicked', 'info');

    // Get selected rows from DevExpress grid or fallback selection
    let selectedOrders = [];

    if (pstGridInstance) {
        selectedOrders = pstGridInstance.getSelectedRowsData();
    } else {
        // Fallback - use checkbox selection
        const selectedIndices = Array.from(pstSelectedRows);
        selectedOrders = selectedIndices.map(idx => pstData[parseInt(idx)]).filter(Boolean);
    }

    if (selectedOrders.length === 0) {
        alert('Please select at least one order to assign a picker.');
        return;
    }

    pstLog(`Selected ${selectedOrders.length} orders for picker assignment`, 'info');

    // Check if pickers are loaded
    if (!window.pickersData || window.pickersData.length === 0) {
        pstLog('Pickers not loaded, loading now...', 'info');
        if (typeof window.loadPickers === 'function') {
            window.loadPickers();
            // Wait for pickers to load then open dialog
            setTimeout(() => {
                if (window.pickersData && window.pickersData.length > 0) {
                    openPstAssignPickerDialog(selectedOrders);
                } else {
                    alert('Failed to load pickers. Please try again.');
                }
            }, 1500);
        } else {
            alert('Pickers module not loaded. Please refresh the page.');
        }
        return;
    }

    openPstAssignPickerDialog(selectedOrders);
}

// Open Assign Picker Dialog for PST
function openPstAssignPickerDialog(selectedOrders) {
    pstLog(`Opening picker dialog for ${selectedOrders.length} orders`, 'info');

    // Build picker options from window.pickersData (same as app.js)
    let pickerOptionsHtml = '';

    if (window.pickersData && window.pickersData.length > 0) {
        // Filter out deleted pickers
        const activePickers = window.pickersData.filter(p => p.deleted !== 1);
        activePickers.forEach(picker => {
            const pickerId = picker.picker_id || picker.PICKER_ID || picker.id || picker.ID || '';
            const pickerName = picker.name || picker.NAME || picker.picker_name || picker.PICKER_NAME || '';
            const pickerType = picker.picker_type || picker.PICKER_TYPE || picker.type || picker.TYPE || '';

            pickerOptionsHtml += `<option value="${pickerId}" data-name="${pickerName}">${pickerName}</option>`;
        });
    }

    if (!pickerOptionsHtml) {
        pickerOptionsHtml = '<option value="" disabled>No pickers available</option>';
    }

    // Create modal HTML
    const modalHtml = `
        <div id="pst-assign-picker-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 25000; justify-content: center; align-items: center;">
            <div style="background: white; width: 90%; max-width: 500px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                <div style="padding: 1rem 1.5rem; border-bottom: 2px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 1.1rem; color: #1e293b; font-weight: 700;">
                        <i class="fas fa-user-check" style="color: #8b5cf6;"></i> Assign Picker
                    </h3>
                    <button onclick="closePstAssignPickerDialog()" style="background: transparent; border: 1px solid #cbd5e1; font-size: 20px; cursor: pointer; color: #64748b; padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 4px;">×</button>
                </div>
                <div style="padding: 1.5rem;">
                    <div style="margin-bottom: 1rem; padding: 0.75rem; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
                        <div style="font-size: 0.875rem; color: #0369a1;">
                            <i class="fas fa-info-circle"></i> Assigning picker to <strong>${selectedOrders.length}</strong> selected order(s)
                        </div>
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #374151; font-size: 0.875rem;">Select Picker:</label>
                        <select id="pst-picker-select" style="width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.875rem;">
                            <option value="">-- Select a Picker --</option>
                            ${pickerOptionsHtml}
                        </select>
                    </div>
                </div>
                <div style="padding: 1rem 1.5rem; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 0.75rem; background: #f9fafb; border-radius: 0 0 12px 12px;">
                    <button onclick="closePstAssignPickerDialog()" style="background: #e5e7eb; color: #374151; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; font-weight: 600;">
                        Cancel
                    </button>
                    <button onclick="submitPstAssignPicker()" style="background: #8b5cf6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; font-weight: 600;">
                        <i class="fas fa-check"></i> Assign
                    </button>
                </div>
            </div>
        </div>
    `;

    // Store selected orders for submission
    window.pstSelectedOrdersForPicker = selectedOrders;

    // Add to DOM
    const modalDiv = document.createElement('div');
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
}

// Close Assign Picker Dialog
function closePstAssignPickerDialog() {
    const modal = document.getElementById('pst-assign-picker-modal');
    if (modal) modal.parentElement.remove();
    window.pstSelectedOrdersForPicker = null;
}

// Submit Assign Picker
function submitPstAssignPicker() {
    const pickerSelect = document.getElementById('pst-picker-select');
    const selectedOption = pickerSelect.options[pickerSelect.selectedIndex];
    const pickerId = pickerSelect.value;
    const pickerName = selectedOption?.getAttribute('data-name') || '';

    if (!pickerId) {
        alert('Please select a picker');
        return;
    }

    const selectedOrders = window.pstSelectedOrdersForPicker || [];
    if (selectedOrders.length === 0) {
        alert('No orders selected');
        closePstAssignPickerDialog();
        return;
    }

    pstLog(`Assigning picker ${pickerName} (${pickerId}) to ${selectedOrders.length} orders`, 'info');

    const fusionInstance = window.currentTripInstance || localStorage.getItem('fusionInstance') || 'TEST';

    // Process each order
    let completed = 0;
    let errors = [];

    selectedOrders.forEach((order, index) => {
        const orderNumber = order.trx_number || '';

        const payload = {
            p_trx_number: orderNumber,
            p_picker_id: pickerId,
            p_picker_name: pickerName,
            p_instance_name: fusionInstance
        };

        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/assignpicker';

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            body: JSON.stringify(payload)
        }, function(error, data) {
            completed++;

            if (error) {
                errors.push(`${orderNumber}: ${error}`);
                pstLog(`Error assigning picker to ${orderNumber}: ${error}`, 'error');
            } else {
                pstLog(`Picker assigned to ${orderNumber}`, 'success');
            }

            // Check if all done
            if (completed === selectedOrders.length) {
                closePstAssignPickerDialog();

                if (errors.length === 0) {
                    alert(`Successfully assigned picker to ${selectedOrders.length} order(s)`);
                } else {
                    alert(`Completed with ${errors.length} error(s):\n${errors.join('\n')}`);
                }

                // Refresh data
                fetchPendingStoreTransactions();
            }
        });
    });
}

// ============================================================================
// ALLOCATE LOTS FOR PST (S2V)
// ============================================================================

// Allocate Lots for S2V orders
function allocateLotsForPst() {
    pstLog('Allocate Lots for S2V clicked', 'info');

    // Get selected rows from DevExpress grid or fallback selection
    let selectedOrders = [];

    if (pstGridInstance) {
        selectedOrders = pstGridInstance.getSelectedRowsData();
    } else {
        // Fallback - use checkbox selection
        const selectedIndices = Array.from(pstSelectedRows);
        selectedOrders = selectedIndices.map(idx => pstData[parseInt(idx)]).filter(Boolean);
    }

    if (selectedOrders.length === 0) {
        alert('Please select at least one order to allocate lots.');
        return;
    }

    pstLog(`Selected ${selectedOrders.length} orders for lot allocation`, 'info');

    // Filter only S2V orders (Store to Van)
    const s2vOrders = selectedOrders.filter(order => {
        const trxType = (order.trx_type || '').toUpperCase();
        return trxType === 'S2V' || trxType === 'STORE TO VAN' || trxType.includes('STORE');
    });

    if (s2vOrders.length === 0) {
        alert('No Store to Van orders selected. This function only works for Store to Van order types.');
        return;
    }

    pstLog(`Found ${s2vOrders.length} S2V orders out of ${selectedOrders.length} selected`, 'info');

    // Create progress dialog
    const dialogHtml = `
        <div id="pst-s2v-allocate-dialog" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 25000; display: flex; align-items: center; justify-content: center;">
            <div style="background: white; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); width: 90%; max-width: 800px; max-height: 80vh; display: flex; flex-direction: column;">
                <div style="padding: 1.5rem; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 1.25rem; font-weight: 600; color: #1f2937;">
                        <i class="fas fa-boxes" style="color: #10b981;"></i> Allocate Lots for Store to Van Orders
                    </h3>
                    <button onclick="closePstS2VDialog()" style="background: none; border: none; font-size: 1.5rem; color: #9ca3af; cursor: pointer; padding: 0; width: 30px; height: 30px;">×</button>
                </div>
                <div style="padding: 1.5rem; overflow-y: auto; flex: 1;">
                    <div style="margin-bottom: 1rem; padding: 1rem; background: #f0fdf4; border-left: 4px solid #10b981; border-radius: 4px;">
                        <div style="font-weight: 600; color: #065f46; margin-bottom: 0.25rem;">Processing ${s2vOrders.length} Store to Van Order(s)</div>
                        <div style="font-size: 0.875rem; color: #047857;">Calling Allocate Lots API for each transaction...</div>
                    </div>
                    <div id="pst-s2v-progress-list" style="display: flex; flex-direction: column; gap: 0.75rem;">
                        ${s2vOrders.map((order, index) => {
                            const orderNumber = order.trx_number || 'Unknown';
                            return `
                                <div id="pst-s2v-item-${index}" style="padding: 1rem; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                        <div style="font-weight: 600; color: #1f2937;">#${index + 1}: ${orderNumber}</div>
                                        <div id="pst-s2v-status-${index}" style="display: flex; align-items: center; gap: 0.5rem;">
                                            <i class="fas fa-clock" style="color: #9ca3af;"></i>
                                            <span style="color: #6b7280; font-size: 0.875rem;">Waiting...</span>
                                        </div>
                                    </div>
                                    <div id="pst-s2v-details-${index}" style="font-size: 0.875rem; color: #6b7280;"></div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                <div style="padding: 1rem 1.5rem; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #f9fafb;">
                    <div id="pst-s2v-summary" style="font-size: 0.875rem; color: #6b7280;">Ready to process...</div>
                    <button onclick="closePstS2VDialog()" style="background: #e5e7eb; color: #374151; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; font-weight: 600;">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `;

    // Add dialog to DOM
    const dialogDiv = document.createElement('div');
    dialogDiv.innerHTML = dialogHtml;
    document.body.appendChild(dialogDiv);

    // Process each S2V order
    processPstS2VOrders(s2vOrders, 0);
}

// Close S2V Dialog
function closePstS2VDialog() {
    const dialog = document.getElementById('pst-s2v-allocate-dialog');
    if (dialog) dialog.parentElement.remove();
}

// Process S2V orders sequentially
function processPstS2VOrders(orders, index) {
    if (index >= orders.length) {
        // All done
        const summaryEl = document.getElementById('pst-s2v-summary');
        if (summaryEl) {
            summaryEl.innerHTML = '<span style="color: #10b981; font-weight: 600;"><i class="fas fa-check-circle"></i> All orders processed!</span>';
        }
        return;
    }

    const order = orders[index];
    const orderNumber = order.trx_number || 'Unknown';
    const fusionInstance = window.currentTripInstance || localStorage.getItem('fusionInstance') || 'TEST';

    // Update status to processing
    const statusDiv = document.getElementById(`pst-s2v-status-${index}`);
    if (statusDiv) {
        statusDiv.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color: #3b82f6;"></i><span style="color: #3b82f6; font-size: 0.875rem;">Processing...</span>';
    }

    // Update summary
    const summaryEl = document.getElementById('pst-s2v-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `Processing ${index + 1} of ${orders.length}...`;
    }

    // Prepare POST data
    const postData = {
        p_trx_number: orderNumber,
        p_instance_name: fusionInstance
    };

    const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fetchlotdetails';

    pstLog(`Processing order ${index + 1}/${orders.length}: ${orderNumber}`, 'info');

    // Call API
    sendMessageToCSharp({
        action: 'executePost',
        fullUrl: apiUrl,
        body: JSON.stringify(postData)
    }, function(error, data) {
        const detailsDiv = document.getElementById(`pst-s2v-details-${index}`);

        if (error) {
            // Error
            if (statusDiv) {
                statusDiv.innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444;"></i><span style="color: #ef4444; font-size: 0.875rem;">Failed</span>';
            }
            if (detailsDiv) {
                detailsDiv.innerHTML = `<div style="color: #ef4444;">Error: ${error}</div>`;
            }
            pstLog(`Error allocating lots for ${orderNumber}: ${error}`, 'error');

            // Process next order
            setTimeout(() => processPstS2VOrders(orders, index + 1), 500);
        } else {
            try {
                const response = typeof data === 'string' ? JSON.parse(data) : data;

                if (response.success) {
                    const recordCount = response.recordCount || 0;
                    if (statusDiv) {
                        statusDiv.innerHTML = '<i class="fas fa-check-circle" style="color: #10b981;"></i><span style="color: #10b981; font-size: 0.875rem;">Success</span>';
                    }
                    if (detailsDiv) {
                        detailsDiv.innerHTML = `
                            <div style="color: #10b981;">✓ ${response.message || 'Success'}</div>
                            <div style="color: #059669; margin-top: 0.25rem;"><strong>${recordCount}</strong> record(s) allocated</div>
                        `;
                    }
                    pstLog(`Allocated ${recordCount} lots for ${orderNumber}`, 'success');
                } else {
                    if (statusDiv) {
                        statusDiv.innerHTML = '<i class="fas fa-exclamation-circle" style="color: #f59e0b;"></i><span style="color: #f59e0b; font-size: 0.875rem;">Warning</span>';
                    }
                    if (detailsDiv) {
                        detailsDiv.innerHTML = `<div style="color: #f59e0b;">${response.message || 'Unknown error'}</div>`;
                    }
                    pstLog(`Warning for ${orderNumber}: ${response.message}`, 'warn');
                }
            } catch (parseError) {
                if (statusDiv) {
                    statusDiv.innerHTML = '<i class="fas fa-exclamation-circle" style="color: #f59e0b;"></i><span style="color: #f59e0b; font-size: 0.875rem;">Parse Error</span>';
                }
                if (detailsDiv) {
                    detailsDiv.innerHTML = `<div style="color: #f59e0b;">Parse Error: ${parseError.message}</div>`;
                }
                pstLog(`Parse error for ${orderNumber}: ${parseError.message}`, 'error');
            }

            // Process next order
            setTimeout(() => processPstS2VOrders(orders, index + 1), 500);
        }
    });
}

// ============================================================================
// EXPORT TO EXCEL
// ============================================================================

// Export Pending Store Transactions to Excel
function exportPstToExcel() {
    pstLog('Export to Excel clicked', 'info');

    if (!pstData || pstData.length === 0) {
        alert('No data to export. Please fetch data first.');
        return;
    }

    // Check if ExcelJS is available
    if (typeof ExcelJS === 'undefined') {
        alert('ExcelJS library not loaded. Please refresh the page.');
        return;
    }

    pstLog(`Exporting ${pstData.length} records to Excel...`, 'info');

    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Pending Store Transactions');

        // Define columns
        worksheet.columns = [
            { header: 'Order #', key: 'trx_number', width: 15 },
            { header: 'Date', key: 'trx_date', width: 12 },
            { header: 'Type', key: 'trx_type', width: 15 },
            { header: 'Source Org', key: 'source_org_code', width: 12 },
            { header: 'From', key: 'source_sub_inv', width: 15 },
            { header: 'Dest Org', key: 'dest_org_code', width: 12 },
            { header: 'To', key: 'dest_sub_inv', width: 15 },
            { header: 'Items', key: 'total_items', width: 10 },
            { header: 'Status', key: 'transaction_status', width: 15 }
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF667eea' }
        };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        // Add data rows
        pstData.forEach(item => {
            worksheet.addRow({
                trx_number: item.trx_number || '',
                trx_date: item.trx_date || '',
                trx_type: item.trx_type || '',
                source_org_code: item.source_org_code || '',
                source_sub_inv: item.source_sub_inv || '',
                dest_org_code: item.dest_org_code || '',
                dest_sub_inv: item.dest_sub_inv || '',
                total_items: item.total_items || 0,
                transaction_status: item.transaction_status || ''
            });
        });

        // Add borders to all cells
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        // Generate filename with timestamp
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `PendingStoreTransactions_${timestamp}.xlsx`;

        // Write to buffer and download
        workbook.xlsx.writeBuffer().then(buffer => {
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            saveAs(blob, filename);
            pstLog(`Exported ${pstData.length} records to ${filename}`, 'success');
        }).catch(err => {
            pstLog(`Export error: ${err.message}`, 'error');
            alert('Error exporting to Excel: ' + err.message);
        });

    } catch (error) {
        pstLog(`Export error: ${error.message}`, 'error');
        alert('Error exporting to Excel: ' + error.message);
    }
}

// ============================================================================
// API INFO MODAL
// ============================================================================

// Show API info modal for Pending Store Transactions
window.showPstApiInfo = function() {
    const sourceOrg = document.getElementById('pst-source-org')?.value || 'GIC';
    const fromDate = document.getElementById('pst-from-date')?.value || '';
    const toDate = document.getElementById('pst-to-date')?.value || '';
    const instanceName = window.currentTripInstance || localStorage.getItem('fusionInstance') || 'PROD';

    const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/PendingS2Vtransactions?P_SOURCE_ORG=${sourceOrg}&P_FROM_DATE=${fromDate}&P_TO_DATE=${toDate}&P_INSTANCE_NAME=${instanceName}`;

    const apiInfo = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <h4 style="margin: 0 0 1rem 0; color: #333; border-bottom: 2px solid #667eea; padding-bottom: 0.5rem;">
                <i class="fas fa-code" style="color: #667eea;"></i> API Information - Pending Store Transactions
            </h4>

            <!-- Fetch Data API -->
            <div style="background: #eff6ff; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #3b82f6;">
                <div style="font-weight: 600; color: #1e40af; margin-bottom: 0.5rem;">Fetch Pending S2V Transactions</div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">Endpoint:</strong>
                    <code style="background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 11px;">
                        TRIPMANAGEMENT/trip/PendingS2Vtransactions
                    </code>
                </div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">Method:</strong>
                    <span style="background: #c6f6d5; color: #22543d; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">GET</span>
                </div>
                <div>
                    <strong style="color: #4a5568;">URL (current filters):</strong>
                    <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px; font-size: 10px; word-break: break-all; display: block; margin-top: 4px;">
                        ${apiUrl}
                    </code>
                </div>
            </div>

            <!-- Parameters Table -->
            <div style="background: #f0fdf4; padding: 1rem; border-radius: 8px; border-left: 4px solid #22c55e;">
                <div style="font-weight: 600; color: #166534; margin-bottom: 0.5rem;">Query Parameters:</div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="background: #dcfce7;">
                            <th style="padding: 6px 8px; text-align: left; border: 1px solid #bbf7d0;">Parameter</th>
                            <th style="padding: 6px 8px; text-align: left; border: 1px solid #bbf7d0;">Value</th>
                            <th style="padding: 6px 8px; text-align: left; border: 1px solid #bbf7d0;">Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;"><code>P_SOURCE_ORG</code></td>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;">${sourceOrg}</td>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;">Source organisation code</td>
                        </tr>
                        <tr style="background: #f0fdf4;">
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;"><code>P_FROM_DATE</code></td>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;">${fromDate}</td>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;">Start date filter</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;"><code>P_TO_DATE</code></td>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;">${toDate}</td>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;">End date filter</td>
                        </tr>
                        <tr style="background: #f0fdf4;">
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;"><code>P_INSTANCE_NAME</code></td>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;">${instanceName}</td>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0;">Fusion instance (PROD / TEST / DEV)</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Create modal
    const modalHtml = `
        <div id="pst-api-info-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 30000; display: flex; align-items: center; justify-content: center;">
            <div style="background: white; width: 90%; max-width: 700px; max-height: 80vh; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
                <div style="padding: 1rem 1.5rem; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                    <span style="font-weight: 700; color: #1e293b; font-size: 1rem;"><i class="fas fa-code" style="color: #667eea;"></i> API Info</span>
                    <button onclick="document.getElementById('pst-api-info-modal').parentElement.remove()" style="background: transparent; border: 1px solid #cbd5e1; font-size: 18px; cursor: pointer; color: #64748b; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 4px;">×</button>
                </div>
                <div style="padding: 1.5rem; overflow-y: auto; flex: 1;">
                    ${apiInfo}
                </div>
            </div>
        </div>
    `;

    const modalDiv = document.createElement('div');
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
};

// Expose functions globally
window.assignPickerForPst = assignPickerForPst;
window.allocateLotsForPst = allocateLotsForPst;
window.closePstAssignPickerDialog = closePstAssignPickerDialog;
window.submitPstAssignPicker = submitPstAssignPicker;
window.closePstS2VDialog = closePstS2VDialog;
window.exportPstToExcel = exportPstToExcel;

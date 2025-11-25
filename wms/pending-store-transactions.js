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
});

// Initialize the page
function initializePendingStoreTransactions() {
    // Set default dates (today)
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('pst-from-date').value = today;
    document.getElementById('pst-to-date').value = today;

    // Initialize empty grid
    initializePstGrid([]);

    console.log('[PST] Pending Store Transactions initialized');
}

// Fetch pending store transactions from API
async function fetchPendingStoreTransactions() {
    const sourceOrg = document.getElementById('pst-source-org').value;
    const fromDate = document.getElementById('pst-from-date').value;
    const toDate = document.getElementById('pst-to-date').value;

    if (!fromDate || !toDate) {
        alert('Please select both From Date and To Date');
        return;
    }

    // Show loading state
    const fetchIcon = document.getElementById('pst-fetch-icon');
    fetchIcon.className = 'fas fa-spinner fa-spin';

    const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/PendingS2Vtransactions?P_SOURCE_ORG=${sourceOrg}&P_FROM_DATE=${fromDate}&P_TO_DATE=${toDate}`;

    console.log('[PST] Fetching from:', apiUrl);

    try {
        // Use C# REST handler via WebView
        window.chrome.webview.postMessage({
            type: 'REST_API_CALL',
            url: apiUrl,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            callbackId: 'pst-fetch-data'
        });

        // Listen for response
        const handleResponse = (event) => {
            const data = event.data;
            if (data.callbackId === 'pst-fetch-data') {
                window.chrome.webview.removeEventListener('message', handleResponse);

                fetchIcon.className = 'fas fa-search';

                try {
                    let responseData = data.data;
                    if (typeof responseData === 'string') {
                        // Fix potential JSON issues
                        responseData = responseData.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                        responseData = JSON.parse(responseData);
                    }

                    pstData = responseData.items || responseData || [];
                    console.log('[PST] Fetched', pstData.length, 'records');

                    // Clear selections
                    pstSelectedRows.clear();

                    // Update KPI cards
                    updatePstKpiCards();

                    // Refresh grid
                    initializePstGrid(pstData);

                    // Update last fetch time
                    document.getElementById('pst-last-fetch').textContent =
                        'Last fetched: ' + new Date().toLocaleTimeString();

                } catch (e) {
                    console.error('[PST] Parse error:', e);
                    alert('Error parsing response data');
                }
            }
        };

        window.chrome.webview.addEventListener('message', handleResponse);

    } catch (error) {
        console.error('[PST] Fetch error:', error);
        fetchIcon.className = 'fas fa-search';
        alert('Error fetching data: ' + error.message);
    }
}

// Update KPI cards
function updatePstKpiCards() {
    // Total Lines
    document.getElementById('pst-total-lines').textContent = pstData.length;

    // Total Orders (distinct order numbers)
    const distinctOrders = [...new Set(pstData.map(t => t.TRX_NUMBER || t.trx_number).filter(Boolean))];
    document.getElementById('pst-total-orders').textContent = distinctOrders.length;

    // Selected count
    document.getElementById('pst-selected-count').textContent = pstSelectedRows.size;
}

// Initialize DevExpress Grid
function initializePstGrid(data) {
    const container = document.getElementById('pst-grid-container');

    // Check if DevExtreme is available
    if (typeof DevExpress === 'undefined') {
        // Fallback to HTML table if DevExtreme not available
        renderFallbackTable(data);
        return;
    }

    // Destroy existing grid instance
    if (pstGridInstance) {
        pstGridInstance.dispose();
    }

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
            document.getElementById('pst-selected-count').textContent = pstSelectedRows.size;
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
            {
                dataField: 'TRX_NUMBER',
                caption: 'Order #',
                width: 120,
                cssClass: 'font-weight-bold'
            },
            {
                dataField: 'LID',
                caption: 'LID',
                width: 80
            },
            {
                dataField: 'ITEM_CODE',
                caption: 'Item Code',
                width: 120
            },
            {
                dataField: 'ITEM_DESC',
                caption: 'Item Description',
                width: 250
            },
            {
                dataField: 'PICKED_QTY',
                caption: 'Qty',
                width: 70,
                dataType: 'number',
                alignment: 'center'
            },
            {
                dataField: 'LOT_NUMBER',
                caption: 'Lot #',
                width: 100
            },
            {
                dataField: 'SOURCE_SUB_INV',
                caption: 'From',
                width: 80
            },
            {
                dataField: 'DEST_SUB_INV',
                caption: 'To',
                width: 80
            },
            {
                dataField: 'TRANSACTION_DATE',
                caption: 'Date',
                width: 100,
                dataType: 'date',
                format: 'yyyy-MM-dd'
            },
            {
                caption: 'Actions',
                width: 120,
                alignment: 'center',
                cellTemplate: function(container, options) {
                    const rowData = options.data;
                    const actionDiv = document.createElement('div');
                    actionDiv.style.display = 'flex';
                    actionDiv.style.gap = '4px';
                    actionDiv.style.justifyContent = 'center';

                    // Add to Trip button
                    const addBtn = document.createElement('button');
                    addBtn.innerHTML = '<i class="fas fa-plus"></i>';
                    addBtn.title = 'Add to Trip';
                    addBtn.style.cssText = 'background: #10b981; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px;';
                    addBtn.onclick = function(e) {
                        e.stopPropagation();
                        addSingleToTrip(rowData);
                    };

                    // Edit button
                    const editBtn = document.createElement('button');
                    editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                    editBtn.title = 'Edit';
                    editBtn.style.cssText = 'background: #667eea; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px;';
                    editBtn.onclick = function(e) {
                        e.stopPropagation();
                        editPstTransaction(rowData);
                    };

                    actionDiv.appendChild(addBtn);
                    actionDiv.appendChild(editBtn);
                    container.appendChild(actionDiv);
                }
            }
        ],
        onContentReady: function(e) {
            console.log('[PST] Grid content ready');
        }
    });
}

// Fallback HTML table if DevExtreme not available
function renderFallbackTable(data) {
    const container = document.getElementById('pst-grid-container');

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

    html += `
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
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
    document.getElementById('pst-selected-count').textContent = pstSelectedRows.size;
}

// Toggle single row selection
function togglePstRowSelection(lid, checked) {
    if (checked) {
        pstSelectedRows.add(lid);
    } else {
        pstSelectedRows.delete(lid);
    }
    document.getElementById('pst-selected-count').textContent = pstSelectedRows.size;
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
    console.log('[PST] Adding single row to trip:', rowData);
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

    console.log('[PST] Adding', selectedData.length, 'rows to trip');
    // TODO: Implement add to trip modal/functionality
    alert('Adding ' + selectedData.length + ' item(s) to trip');
}

// Edit transaction
function editPstTransaction(rowData) {
    console.log('[PST] Editing transaction:', rowData);
    // TODO: Implement edit modal/functionality
    alert('Edit: ' + (rowData.TRX_NUMBER || rowData.trx_number) + ' - LID: ' + (rowData.LID || rowData.lid));
}

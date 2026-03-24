// ============================================================================
// PENDING SHIPMENT LINES - Management Page
// ============================================================================

console.log('[PSL] Pending Shipment Lines module loading...');

// API Endpoints
const PSL_PENDING_ORDERS_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/getpendingorders';
const PSL_SHIPMENT_LINES_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/getpendingshipmentlines';
const PSL_ORDER_VOLUME_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/fetchordervolume';

// Global variables
let pslGrid = null;
let pslData = [];
let pslInitialized = false;

// ============================================================================
// INITIALIZATION
// ============================================================================

function initializePslPage() {
    if (pslInitialized) return;

    console.log('[PSL] Initializing Pending Shipment Lines page...');

    // Set default dates (current month)
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    document.getElementById('psl-from-date').value = formatDateForInput(firstDay);
    document.getElementById('psl-to-date').value = formatDateForInput(lastDay);

    // Set default organization
    document.getElementById('psl-organization').value = 'GRAYS INC';

    // Set instance name from top-level selector
    const topInstanceElement = document.getElementById('current-instance-display');
    const pslInstanceDropdown = document.getElementById('psl-instance-name');
    if (topInstanceElement && pslInstanceDropdown) {
        const topInstance = topInstanceElement.textContent.trim();
        if (topInstance && ['PROD', 'TEST', 'DEV'].includes(topInstance)) {
            pslInstanceDropdown.value = topInstance;
            console.log('[PSL] Instance set from top selector:', topInstance);
        }
    }

    // Initialize grid
    initializePslGrid();

    // Load initial data (pending orders)
    loadInitialPslData();

    pslInitialized = true;
    console.log('[PSL] Page initialized');
}

function formatDateForInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ============================================================================
// GRID INITIALIZATION
// ============================================================================

function initializePslGrid() {
    console.log('[PSL] Initializing DevExpress grid...');

    pslGrid = $('#psl-grid-container').dxDataGrid({
        dataSource: [],
        showBorders: true,
        showRowLines: true,
        showColumnLines: true,
        rowAlternationEnabled: true,
        columnAutoWidth: true,
        allowColumnReordering: true,
        allowColumnResizing: true,
        columnResizingMode: 'widget',
        hoverStateEnabled: true,
        selection: {
            mode: 'multiple',
            showCheckBoxesMode: 'always',
            allowSelectAll: true
        },
        filterRow: {
            visible: true,
            applyFilter: 'auto'
        },
        searchPanel: {
            visible: true,
            width: 300,
            placeholder: 'Search...'
        },
        headerFilter: {
            visible: true
        },
        groupPanel: {
            visible: true
        },
        paging: {
            pageSize: 25
        },
        pager: {
            visible: true,
            showPageSizeSelector: true,
            allowedPageSizes: [10, 25, 50, 100],
            showInfo: true
        },
        export: {
            enabled: true,
            fileName: 'PendingShipmentLines'
        },
        onExporting: function(e) {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Pending Shipment Lines');

            DevExpress.excelExporter.exportDataGrid({
                component: e.component,
                worksheet: worksheet,
                autoFilterEnabled: true,
                customizeCell: function(options) {
                    const { gridCell, excelCell } = options;
                    if (gridCell.rowType === 'header') {
                        excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF667EEA' } };
                        excelCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    }
                }
            }).then(function() {
                workbook.xlsx.writeBuffer().then(function(buffer) {
                    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'PendingShipmentLines.xlsx');
                });
            });

            e.cancel = true;
        },
        columns: [
            { dataField: 'source_order_number', caption: 'Order Number', width: 180 },
            { dataField: 'account_number', caption: 'Account #', width: 100 },
            { dataField: 'account_name', caption: 'Customer Name', width: 220 },
            { dataField: 'order_date', caption: 'Order Date', dataType: 'date', format: 'yyyy-MM-dd', width: 120 },
            { dataField: 'line_status', caption: 'Status', width: 120 },
            { dataField: 'order_type_code', caption: 'Order Type', width: 130 },
            { dataField: 'salesrep_name', caption: 'Sales Rep', width: 150 },
            { dataField: 'added_to_trip', caption: 'Added to Trip', width: 110 },
            { dataField: 'instance', caption: 'Instance', width: 80 },
            {
                caption: 'Order Volume',
                columns: [
                    {
                        dataField: 'vol_total_volume',
                        caption: 'Volume (CBM)',
                        width: 110,
                        dataType: 'number',
                        format: { type: 'fixedPoint', precision: 3 },
                        cssClass: 'volume-cell',
                        cellTemplate: function(container, options) {
                            if (options.value !== undefined && options.value !== null) {
                                $('<span>').text(parseFloat(options.value).toFixed(3)).css({ color: '#7c3aed', fontWeight: '600' }).appendTo(container);
                            } else {
                                $('<span>').text('—').css({ color: '#94a3b8' }).appendTo(container);
                            }
                        }
                    },
                    {
                        dataField: 'vol_total_weight',
                        caption: 'Weight (KG)',
                        width: 110,
                        dataType: 'number',
                        format: { type: 'fixedPoint', precision: 2 },
                        cellTemplate: function(container, options) {
                            if (options.value !== undefined && options.value !== null) {
                                $('<span>').text(parseFloat(options.value).toFixed(2)).css({ color: '#0369a1', fontWeight: '600' }).appendTo(container);
                            } else {
                                $('<span>').text('—').css({ color: '#94a3b8' }).appendTo(container);
                            }
                        }
                    },
                    {
                        dataField: 'vol_item_count',
                        caption: 'Item Count',
                        width: 90,
                        dataType: 'number',
                        cellTemplate: function(container, options) {
                            if (options.value !== undefined && options.value !== null) {
                                $('<span>').text(options.value).css({ color: '#065f46', fontWeight: '600' }).appendTo(container);
                            } else {
                                $('<span>').text('—').css({ color: '#94a3b8' }).appendTo(container);
                            }
                        }
                    },
                    {
                        dataField: 'vol_pallet_count',
                        caption: 'Pallets',
                        width: 80,
                        dataType: 'number',
                        cellTemplate: function(container, options) {
                            if (options.value !== undefined && options.value !== null) {
                                $('<span>').text(options.value).css({ color: '#92400e', fontWeight: '600' }).appendTo(container);
                            } else {
                                $('<span>').text('—').css({ color: '#94a3b8' }).appendTo(container);
                            }
                        }
                    }
                ]
            }
        ],
        onSelectionChanged: function(e) {
            const count = e.selectedRowsData.length;
            document.getElementById('psl-selected-count').textContent = count;
        },
        onContentReady: function(e) {
            const totalCount = e.component.totalCount();
            document.getElementById('psl-total-records').textContent = totalCount;
        }
    }).dxDataGrid('instance');

    console.log('[PSL] Grid initialized');
}

// ============================================================================
// LOAD INITIAL DATA (Pending Orders)
// ============================================================================

function loadInitialPslData() {
    console.log('[PSL] ========== REFRESH BUTTON CLICKED ==========');
    console.log('[PSL] Loading initial data...');

    // Get instance from the page's instance dropdown
    const instanceDropdown = document.getElementById('psl-instance-name');
    const instance = instanceDropdown ? instanceDropdown.value : 'PROD';

    const apiUrl = `${PSL_PENDING_ORDERS_API}?instance=${instance}`;

    console.log('[PSL] Instance Dropdown Found:', !!instanceDropdown);
    console.log('[PSL] Instance Value:', instance);
    console.log('[PSL] Full API URL:', apiUrl);

    // Show loading state
    if (pslGrid) {
        pslGrid.beginCustomLoading('Loading pending orders...');
    }

    // Call API via C# backend
    if (window.chrome && window.chrome.webview) {
        console.log('[PSL] Using WebView2 to call API...');
        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            if (pslGrid) {
                pslGrid.endCustomLoading();
            }

            if (error) {
                console.error('[PSL] API Error:', error);
                showPslError('Failed to load initial data: ' + error);
            } else {
                console.log('[PSL] Raw Response:', data);
                try {
                    const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
                    console.log('[PSL] Parsed JSON:', JSON.stringify(jsonData, null, 2));
                    handlePslData(jsonData, 'initial');
                } catch (parseError) {
                    console.error('[PSL] Parse Error:', parseError);
                    showPslError('Error parsing data: ' + parseError.message);
                }
            }
        });
    } else {
        // Fallback for browser testing
        console.log('[PSL] WebView not available, using fetch...');
        fetch(apiUrl)
            .then(response => response.json())
            .then(data => {
                if (pslGrid) pslGrid.endCustomLoading();
                console.log('[PSL] Fetch Response:', data);
                handlePslData(data, 'initial');
            })
            .catch(error => {
                if (pslGrid) pslGrid.endCustomLoading();
                console.error('[PSL] Fetch error:', error);
                showPslError('Failed to load data: ' + error.message);
            });
    }
}

// ============================================================================
// FETCH PENDING SHIPMENT LINES (With Filters)
// ============================================================================

window.fetchPendingShipmentLines = function() {
    console.log('[PSL] Fetching pending shipment lines...');

    // Get filter values
    const organization = document.getElementById('psl-organization').value || 'GRAYS INC';
    const fromDate = document.getElementById('psl-from-date').value;
    const toDate = document.getElementById('psl-to-date').value;

    // Get instance from the page's instance dropdown
    const instanceDropdown = document.getElementById('psl-instance-name');
    const instance = instanceDropdown ? instanceDropdown.value : 'PROD';

    if (!fromDate || !toDate) {
        alert('Please select both From Date and To Date');
        return;
    }

    // Build request body for POST
    const requestBody = {
        p_instance_name: instance,
        P2_ORG_D: organization,
        P2_DATE_FROM_D: fromDate,
        P2_DATE_TO_D: toDate
    };

    console.log('[PSL] API URL:', PSL_SHIPMENT_LINES_API);
    console.log('[PSL] Request Body:', requestBody);

    // Show loading state
    const fetchIcon = document.getElementById('psl-fetch-icon');
    if (fetchIcon) {
        fetchIcon.className = 'fas fa-spinner fa-spin';
    }

    if (pslGrid) {
        pslGrid.beginCustomLoading('Loading shipment lines...');
    }

    // Call API via C# backend using POST
    if (window.chrome && window.chrome.webview) {
        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: PSL_SHIPMENT_LINES_API,
            body: JSON.stringify(requestBody)
        }, function(error, data) {
            // Reset loading state
            if (fetchIcon) {
                fetchIcon.className = 'fas fa-search';
            }
            if (pslGrid) {
                pslGrid.endCustomLoading();
            }

            if (error) {
                console.error('[PSL] Error fetching shipment lines:', error);
                showPslError('Failed to fetch data: ' + error);
            } else {
                try {
                    const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
                    handlePslData(jsonData, 'shipment');
                } catch (parseError) {
                    console.error('[PSL] Error parsing response:', parseError);
                    showPslError('Error parsing data: ' + parseError.message);
                }
            }
        });
    } else {
        // Fallback for browser testing using POST
        fetch(PSL_SHIPMENT_LINES_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        })
            .then(response => response.json())
            .then(data => {
                if (fetchIcon) fetchIcon.className = 'fas fa-search';
                if (pslGrid) pslGrid.endCustomLoading();
                handlePslData(data, 'shipment');
            })
            .catch(error => {
                if (fetchIcon) fetchIcon.className = 'fas fa-search';
                if (pslGrid) pslGrid.endCustomLoading();
                console.error('[PSL] Fetch error:', error);
                showPslError('Failed to fetch data: ' + error.message);
            });
    }
};

// ============================================================================
// HANDLE DATA RESPONSE
// ============================================================================

function handlePslData(data, source) {
    console.log('[PSL] Handling data from:', source, data);

    // Extract items array
    let items = [];
    if (Array.isArray(data)) {
        items = data;
    } else if (data && data.items) {
        items = data.items;
    } else if (data && Array.isArray(data.data)) {
        items = data.data;
    }

    pslData = items;

    // Update grid
    if (pslGrid) {
        pslGrid.option('dataSource', pslData);
        pslGrid.refresh();
    }

    // Update KPIs
    document.getElementById('psl-total-records').textContent = pslData.length;

    // Calculate total quantity if available
    const totalQty = pslData.reduce((sum, item) => {
        return sum + (parseFloat(item.ordered_quantity) || 0);
    }, 0);
    document.getElementById('psl-total-qty').textContent = Math.round(totalQty);

    // Update last fetch time
    const now = new Date();
    document.getElementById('psl-last-fetch').textContent =
        `Last fetched: ${now.toLocaleTimeString()}`;

    console.log('[PSL] Loaded', pslData.length, 'records');
}

// ============================================================================
// GET ORDER VOLUME
// ============================================================================

window.getPslOrderVolume = async function() {
    if (!pslGrid) {
        alert('Please load data first.');
        return;
    }

    const selectedRows = pslGrid.getSelectedRowsData();
    if (selectedRows.length === 0) {
        alert('Please select at least one order to fetch volume data.');
        return;
    }

    const total = selectedRows.length;
    const instanceDropdown = document.getElementById('psl-instance-name');
    const instance = instanceDropdown ? instanceDropdown.value : 'PROD';

    const btn = document.getElementById('psl-get-volume-btn');
    const btnIcon = document.getElementById('psl-volume-btn-icon');
    const progressBar = document.getElementById('psl-volume-progress');
    const progressText = document.getElementById('psl-volume-progress-text');
    const progressIcon = document.getElementById('psl-volume-progress-icon');

    // Show progress, disable button
    if (btn) btn.disabled = true;
    if (btnIcon) btnIcon.className = 'fas fa-spinner fa-spin';
    if (progressBar) { progressBar.style.display = 'inline-flex'; }
    if (progressText) progressText.textContent = `0 / ${total} fetched`;

    console.log('[PSL] Fetching order volume for', total, 'orders...');

    let successCount = 0;
    let failCount = 0;

    for (const row of selectedRows) {
        const orderNumber = row.source_order_number;
        if (!orderNumber) { failCount++; continue; }

        const apiUrl = `${PSL_ORDER_VOLUME_API}?p_instance_name=${encodeURIComponent(instance)}&source_order_number=${encodeURIComponent(orderNumber)}&p_trip_id=`;

        try {
            const volumeData = await callOrderVolumeApi(apiUrl);
            if (volumeData) {
                const dataRow = pslData.find(r => r.source_order_number === orderNumber);
                if (dataRow) {
                    dataRow.vol_total_volume = volumeData.total_volume_cbm ?? volumeData.total_volume ?? volumeData.volume_cbm ?? volumeData.volume ?? null;
                    dataRow.vol_total_weight = volumeData.total_weight_kg ?? volumeData.total_weight ?? volumeData.weight_kg ?? volumeData.weight ?? null;
                    dataRow.vol_item_count   = volumeData.item_count ?? volumeData.total_items ?? volumeData.items ?? null;
                    dataRow.vol_pallet_count = volumeData.pallet_count ?? volumeData.total_pallets ?? volumeData.pallets ?? null;
                }
                successCount++;
            }
        } catch (err) {
            console.error('[PSL] Volume fetch error for', orderNumber, err);
            failCount++;
        }

        // Update progress after each order
        const done = successCount + failCount;
        if (progressText) {
            progressText.textContent = failCount > 0
                ? `${done} / ${total} fetched  (${failCount} failed)`
                : `${done} / ${total} fetched`;
        }
    }

    // Refresh grid with updated data
    if (pslGrid) {
        pslGrid.option('dataSource', [...pslData]);
        pslGrid.refresh();
    }

    // Restore button, update progress to done state
    if (btn) btn.disabled = false;
    if (btnIcon) btnIcon.className = 'fas fa-cube';
    if (progressIcon) progressIcon.className = failCount > 0 ? 'fas fa-exclamation-triangle' : 'fas fa-check-circle';
    if (progressBar) {
        progressBar.style.color = failCount > 0 ? '#b45309' : '#059669';
        progressBar.style.background = failCount > 0 ? '#fef3c7' : '#d1fae5';
        progressBar.style.borderColor = failCount > 0 ? '#fcd34d' : '#6ee7b7';
    }
    if (progressText) {
        progressText.textContent = failCount > 0
            ? `${successCount} / ${total} fetched  (${failCount} failed)`
            : `${successCount} / ${total} fetched`;
    }

    console.log(`[PSL] Volume fetch complete: ${successCount} ok, ${failCount} failed`);
};

function callOrderVolumeApi(apiUrl) {
    return new Promise(function(resolve, reject) {
        if (window.chrome && window.chrome.webview) {
            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: '{}'
            }, function(error, data) {
                if (error) {
                    reject(error);
                } else {
                    try {
                        const json = typeof data === 'string' ? JSON.parse(data) : data;
                        // Unwrap if wrapped in items/data array
                        const result = Array.isArray(json) ? json[0] : (json.items ? json.items[0] : json);
                        resolve(result || null);
                    } catch (e) {
                        reject(e);
                    }
                }
            });
        } else {
            fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                .then(r => r.json())
                .then(json => {
                    const result = Array.isArray(json) ? json[0] : (json.items ? json.items[0] : json);
                    resolve(result || null);
                })
                .catch(reject);
        }
    });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showPslError(message) {
    alert('Error: ' + message);
}

window.refreshPslGrid = function() {
    console.log('[PSL] Refreshing grid...');
    loadInitialPslData();
};

window.exportPslToExcel = function() {
    console.log('[PSL] Exporting to Excel...');
    if (!pslGrid) { alert('Grid not ready. Please load data first.'); return; }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pending Shipment Lines');

    DevExpress.excelExporter.exportDataGrid({
        component: pslGrid,
        worksheet: worksheet,
        autoFilterEnabled: true,
        customizeCell: function(options) {
            const { gridCell, excelCell } = options;
            if (gridCell.rowType === 'header') {
                excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF667EEA' } };
                excelCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            }
        }
    }).then(function() {
        workbook.xlsx.writeBuffer().then(function(buffer) {
            saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'PendingShipmentLines.xlsx');
        });
    });
};

// ============================================================================
// SHOW API INFO
// ============================================================================

window.showPslApiInfo = function() {
    const instanceDropdown = document.getElementById('psl-instance-name');
    const currentInstance = instanceDropdown ? instanceDropdown.value : 'PROD';
    const organization = document.getElementById('psl-organization')?.value || 'GRAYS INC';
    const fromDate = document.getElementById('psl-from-date')?.value || '';
    const toDate = document.getElementById('psl-to-date')?.value || '';

    const apiInfo = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <h4 style="margin: 0 0 1rem 0; color: #333; border-bottom: 2px solid #667eea; padding-bottom: 0.5rem;">
                <i class="fas fa-code" style="color: #667eea;"></i> API Information - Pending Shipment Lines
            </h4>

            <!-- Initial Load API -->
            <div style="background: #f0fdf4; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #22c55e;">
                <div style="font-weight: 600; color: #166534; margin-bottom: 0.5rem;">1. Initial Load (On Page Open)</div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">Endpoint:</strong>
                    <code style="background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 11px;">
                        trips/getpendingorders
                    </code>
                </div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">Method:</strong>
                    <span style="background: #c6f6d5; color: #22543d; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">GET</span>
                </div>
                <div>
                    <strong style="color: #4a5568;">URL:</strong>
                    <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px; font-size: 10px; word-break: break-all; display: block; margin-top: 4px;">
                        ${PSL_PENDING_ORDERS_API}?instance=${currentInstance}
                    </code>
                </div>
            </div>

            <!-- Fetch Data API -->
            <div style="background: #eff6ff; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #3b82f6;">
                <div style="font-weight: 600; color: #1e40af; margin-bottom: 0.5rem;">2. Fetch Data (With Filters)</div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">Endpoint:</strong>
                    <code style="background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 11px;">
                        getpendingshipmentlines
                    </code>
                </div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">Method:</strong>
                    <span style="background: #fed7aa; color: #9c4221; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">POST</span>
                </div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">URL:</strong>
                    <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px; font-size: 10px; word-break: break-all; display: block; margin-top: 4px;">
                        ${PSL_SHIPMENT_LINES_API}
                    </code>
                </div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">Request Body (JSON):</strong>
                    <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px; font-size: 10px; word-break: break-all; display: block; margin-top: 4px;">
                        { "p_instance_name": "${currentInstance}", "P2_ORG_D": "${organization}", "P2_DATE_FROM_D": "${fromDate}", "P2_DATE_TO_D": "${toDate}" }
                    </code>
                </div>
            </div>

            <!-- Parameters Table -->
            <div style="background: #e6fffa; padding: 1rem; border-radius: 8px; border-left: 4px solid #38b2ac;">
                <div style="font-weight: 600; color: #234e52; margin-bottom: 0.5rem;">Parameters:</div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <tr style="background: #b2f5ea;">
                        <th style="padding: 6px 8px; text-align: left; border: 1px solid #81e6d9;">Parameter</th>
                        <th style="padding: 6px 8px; text-align: left; border: 1px solid #81e6d9;">Value</th>
                        <th style="padding: 6px 8px; text-align: left; border: 1px solid #81e6d9;">Source</th>
                    </tr>
                    <tr>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-family: monospace;">p_instance_name</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-weight: 600;">${currentInstance}</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9;"><span style="background: #c6f6d5; color: #22543d; padding: 2px 6px; border-radius: 4px; font-size: 10px;">From Dropdown</span></td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-family: monospace;">P2_ORG_D</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-weight: 600;">${organization}</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9;"><span style="background: #c6f6d5; color: #22543d; padding: 2px 6px; border-radius: 4px; font-size: 10px;">Organization Field</span></td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-family: monospace;">P2_DATE_FROM_D</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-weight: 600;">${fromDate}</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9;"><span style="background: #c6f6d5; color: #22543d; padding: 2px 6px; border-radius: 4px; font-size: 10px;">From Date Field</span></td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-family: monospace;">P2_DATE_TO_D</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-weight: 600;">${toDate}</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9;"><span style="background: #c6f6d5; color: #22543d; padding: 2px 6px; border-radius: 4px; font-size: 10px;">To Date Field</span></td>
                    </tr>
                </table>
            </div>
        </div>
    `;

    // Create and show popup
    const popup = document.createElement('div');
    popup.id = 'psl-api-info-popup';
    popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10002; display: flex; justify-content: center; align-items: center;';
    popup.innerHTML = `
        <div style="background: white; width: 90%; max-width: 700px; max-height: 85%; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
            <div style="padding: 1.5rem; max-height: calc(85vh - 60px); overflow-y: auto;">
                ${apiInfo}
            </div>
            <div style="padding: 1rem 1.5rem; border-top: 2px solid #f0f0f0; text-align: right;">
                <button onclick="document.getElementById('psl-api-info-popup').remove()" class="btn btn-secondary" style="padding: 8px 20px;">
                    <i class="fas fa-times"></i> Close
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(popup);
};

// ============================================================================
// PAGE NAVIGATION HANDLER
// ============================================================================

// Initialize when page is shown
$(document).ready(function() {
    $(document).on('click', '.menu-item[data-page="pending-shipment-lines"]', function() {
        setTimeout(function() {
            initializePslPage();
        }, 100);
    });
});

console.log('[PSL] Pending Shipment Lines module loaded');

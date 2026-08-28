// ============================================================================
// PENDING SHIPMENT LINES - Management Page
// ============================================================================

console.log('[PSL] Pending Shipment Lines module loading...');

// API Endpoints
const PSL_ORDER_VOLUME_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/fetchordervolume';

// Oracle Fusion shipmentLines REST API
const PSL_FUSION_RESOURCE = '/fscmRestApi/resources/11.13.18.05/shipmentLines';
const PSL_FUSION_FIELDS = 'OrganizationCode,OrderType,ShipmentLine,Order,OrderLine,Item,ItemDescription,LineStatus,RequestedDate,RequestedQuantity,RequestedQuantityUOM';
const PSL_PAGE_SIZE = 50;

// Global variables
let pslGrid = null;
let pslData = [];
let pslInitialized = false;
let pslVolumeCancelRequested = false;
let pslOffset = 0;
let pslHasMore = false;
let pslFetchInProgress = false;

function getPslFusionBaseUrl() {
    const instanceDropdown = document.getElementById('psl-instance-name');
    const instance = instanceDropdown ? instanceDropdown.value : 'PROD';
    return instance === 'PROD'
        ? 'https://efmh.fa.em3.oraclecloud.com'
        : 'https://efmh-test.fa.em3.oraclecloud.com';
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initializePslPage() {
    if (pslInitialized) return;

    console.log('[PSL] Initializing Pending Shipment Lines page...');

    // Set default creation date (2 days ago) with '>' operator
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() - 2);
    document.getElementById('psl-creation-date').value = formatDateForInput(defaultDate);

    // Set default mandatory filters
    document.getElementById('psl-organization').value = 'GIC';
    document.getElementById('psl-order-type').value = 'Sales order';

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

    // Load initial data from Fusion using the default filters
    fetchPendingShipmentLines();

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
            { dataField: 'RequestedDate', caption: 'Requested Date', dataType: 'date', format: 'yyyy-MM-dd', width: 130 },
            {
                dataField: 'LineStatus',
                caption: 'Line Status',
                width: 150,
                cellTemplate: function(container, options) {
                    $('<span>').text(options.value || '')
                        .css({ background: '#eff6ff', color: '#1d4ed8', padding: '2px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: '600' })
                        .appendTo(container);
                }
            },
            { dataField: 'OrganizationCode', caption: 'Org', width: 70 },
            { dataField: 'ShipmentLine', caption: 'Shipment Line', width: 120 },
            { dataField: 'OrderType', caption: 'Order Type', width: 110 },
            { dataField: 'Order', caption: 'Order', width: 160 },
            { dataField: 'OrderLine', caption: 'Line', width: 70 },
            { dataField: 'Item', caption: 'Item', width: 150 },
            { dataField: 'ItemDescription', caption: 'Description', width: 280 },
            { dataField: 'RequestedQuantity', caption: 'Requested Qty', dataType: 'number', width: 110 },
            { dataField: 'RequestedQuantityUOM', caption: 'UOM', width: 80 },
            {
                dataField: 'OrderVolume',
                caption: 'Order Volume',
                width: 120,
                dataType: 'number',
                cellTemplate: function(container, options) {
                    if (options.value !== undefined && options.value !== null) {
                        $('<span>').text(parseFloat(options.value).toFixed(3)).css({ color: '#7c3aed', fontWeight: '600' }).appendTo(container);
                    } else {
                        $('<span>').text('—').css({ color: '#94a3b8' }).appendTo(container);
                    }
                }
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
// BUILD FUSION shipmentLines URL (from filter parameters)
// ============================================================================

function getPslFilterValues() {
    // Organization: allow "GIC" or "GIC — GRAYS INC" style manual entries
    let organization = (document.getElementById('psl-organization')?.value || '').trim();
    if (organization.includes('—')) organization = organization.split('—')[0].trim();
    if (organization.includes(' - ')) organization = organization.split(' - ')[0].trim();

    return {
        dateOperator: document.getElementById('psl-date-operator')?.value || '>',
        creationDate: document.getElementById('psl-creation-date')?.value || '',
        organization: organization,
        orderType: (document.getElementById('psl-order-type')?.value || '').trim(),
        order: (document.getElementById('psl-order')?.value || '').trim(),
        item: (document.getElementById('psl-item')?.value || '').trim(),
        lineStatus: document.getElementById('psl-line-status')?.value || ''
    };
}

function buildPslFusionUrl(offset) {
    const f = getPslFilterValues();

    const qParts = [];
    if (f.creationDate) qParts.push(`CreationDate${f.dateOperator}${f.creationDate}`);
    qParts.push(`OrganizationCode='${f.organization}'`);
    qParts.push(`OrderType='${f.orderType}'`);
    if (f.order) qParts.push(`Order='${f.order}'`);
    if (f.item) qParts.push(`Item='${f.item}'`);
    if (f.lineStatus) qParts.push(`LineStatus='${f.lineStatus}'`);

    const q = qParts.join(';');
    return `${getPslFusionBaseUrl()}${PSL_FUSION_RESOURCE}`
        + `?q=${encodeURIComponent(q)}`
        + `&onlyData=true`
        + `&fields=${PSL_FUSION_FIELDS}`
        + `&limit=${PSL_PAGE_SIZE}`
        + `&offset=${offset}`;
}

// ============================================================================
// FETCH PENDING SHIPMENT LINES (Oracle Fusion shipmentLines REST API)
// ============================================================================

window.fetchPendingShipmentLines = function() {
    fetchPslPage(false);
};

window.fetchNextPslPage = function() {
    if (!pslHasMore) return;
    fetchPslPage(true);
};

function fetchPslPage(append) {
    if (pslFetchInProgress) return;

    const f = getPslFilterValues();

    // Organization and Order Type are mandatory
    if (!f.organization) {
        alert('Organization is mandatory. Please select or enter an organization code.');
        return;
    }
    if (!f.orderType) {
        alert('Order Type is mandatory. Please select or enter an order type.');
        return;
    }

    const offset = append ? pslOffset : 0;
    const apiUrl = buildPslFusionUrl(offset);
    const instanceDropdown = document.getElementById('psl-instance-name');
    const instance = instanceDropdown ? instanceDropdown.value : 'PROD';

    console.log('[PSL] Fetching shipment lines from Fusion. Offset:', offset);
    console.log('[PSL] API URL:', apiUrl);

    // Show loading state
    pslFetchInProgress = true;
    const fetchIcon = document.getElementById(append ? 'psl-fetch-next-icon' : 'psl-fetch-icon');
    const fetchIconDefault = append ? 'fas fa-angle-double-down' : 'fas fa-search';
    if (fetchIcon) fetchIcon.className = 'fas fa-spinner fa-spin';
    if (pslGrid) pslGrid.beginCustomLoading('Loading shipment lines...');

    const done = function() {
        pslFetchInProgress = false;
        if (fetchIcon) fetchIcon.className = fetchIconDefault;
        if (pslGrid) pslGrid.endCustomLoading();
    };

    const onSuccess = function(data) {
        done();
        try {
            const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
            if (jsonData && (jsonData.ReturnStatus === 'Error' || jsonData['o:errorDetails'])) {
                const errMsg = jsonData.ErrorExplanation || JSON.stringify(jsonData['o:errorDetails'] || jsonData);
                showPslError('Fusion API error: ' + errMsg);
                return;
            }
            handlePslData(jsonData, append);
        } catch (parseError) {
            console.error('[PSL] Error parsing response:', parseError);
            showPslError('Error parsing data: ' + parseError.message);
        }
    };

    // Call Fusion via C# backend (credentials handled in C#)
    if (window.chrome && window.chrome.webview) {
        sendMessageToCSharp({
            action: 'executeOracleFusionGet',
            fullUrl: apiUrl,
            instance: instance
        }, function(error, data) {
            if (error) {
                done();
                console.error('[PSL] Error fetching shipment lines:', error);
                showPslError('Failed to fetch data: ' + error);
            } else {
                onSuccess(data);
            }
        });
    } else {
        // Fallback for browser testing (requires an authenticated session / CORS)
        fetch(apiUrl)
            .then(response => response.json())
            .then(data => onSuccess(data))
            .catch(error => {
                done();
                console.error('[PSL] Fetch error:', error);
                showPslError('Failed to fetch data: ' + error.message);
            });
    }
}

// ============================================================================
// HANDLE DATA RESPONSE
// ============================================================================

function handlePslData(data, append) {
    console.log('[PSL] Handling data. Append:', !!append, data);

    // Extract items array (Fusion returns { items: [...], count, hasMore, ... })
    let items = [];
    if (Array.isArray(data)) {
        items = data;
    } else if (data && data.items) {
        items = data.items;
    }

    pslData = append ? pslData.concat(items) : items;
    pslHasMore = !!(data && data.hasMore);
    pslOffset = (append ? pslOffset : 0) + items.length;

    // Update grid
    if (pslGrid) {
        pslGrid.option('dataSource', pslData);
        pslGrid.refresh();
    }

    // Update KPIs
    document.getElementById('psl-total-records').textContent = pslData.length;

    const totalQty = pslData.reduce((sum, item) => {
        return sum + (parseFloat(item.RequestedQuantity) || 0);
    }, 0);
    document.getElementById('psl-total-qty').textContent = Math.round(totalQty);

    // Update "Fetch Next 50" button state
    const nextBtn = document.getElementById('psl-fetch-next-btn');
    if (nextBtn) {
        nextBtn.disabled = !pslHasMore;
        nextBtn.style.opacity = pslHasMore ? '1' : '0.5';
    }

    // Update loaded info badge
    const loadedInfo = document.getElementById('psl-loaded-info');
    if (loadedInfo) {
        loadedInfo.style.display = 'inline-block';
        loadedInfo.textContent = pslHasMore
            ? `${pslData.length} loaded · more available`
            : `${pslData.length} loaded · all fetched`;
    }

    // Update last fetch time
    const now = new Date();
    document.getElementById('psl-last-fetch').textContent =
        `Last fetched: ${now.toLocaleTimeString()}`;

    console.log('[PSL] Loaded', pslData.length, 'records. hasMore:', pslHasMore);
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

    // Deduplicate order numbers (multiple shipment lines can belong to one order)
    const orderNumbers = [...new Set(selectedRows.map(r => r.Order).filter(Boolean))];
    const total = orderNumbers.length;
    const instanceDropdown = document.getElementById('psl-instance-name');
    const instance = instanceDropdown ? instanceDropdown.value : 'PROD';

    const btn        = document.getElementById('psl-get-volume-btn');
    const btnIcon    = document.getElementById('psl-volume-btn-icon');
    const cancelBtn  = document.getElementById('psl-volume-cancel-btn');
    const progressBar  = document.getElementById('psl-volume-progress');
    const progressText = document.getElementById('psl-volume-progress-text');
    const progressIcon = document.getElementById('psl-volume-progress-icon');

    // Reset cancel flag, show progress, show cancel button
    pslVolumeCancelRequested = false;
    if (btn) btn.disabled = true;
    if (btnIcon) btnIcon.className = 'fas fa-spinner fa-spin';
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    if (progressBar) {
        progressBar.style.display = 'inline-flex';
        progressBar.style.color = '#7c3aed';
        progressBar.style.background = '#f3e8ff';
        progressBar.style.borderColor = '#d8b4fe';
    }
    if (progressText) progressText.textContent = `0 / ${total} fetched`;
    if (progressIcon) progressIcon.className = 'fas fa-spinner fa-spin';

    console.log('[PSL] Fetching order volume for', total, 'orders...');

    let successCount = 0;
    let failCount = 0;
    let cancelled = false;

    for (const orderNumber of orderNumbers) {
        // Check cancel flag before each request
        if (pslVolumeCancelRequested) {
            cancelled = true;
            break;
        }

        const apiUrl = `${PSL_ORDER_VOLUME_API}?p_instance_name=${encodeURIComponent(instance)}&source_order_number=${encodeURIComponent(orderNumber)}&p_trip_id=`;

        try {
            const volumeData = await callOrderVolumeApi(apiUrl);
            if (volumeData) {
                pslData.forEach(function(dataRow) {
                    if (dataRow.Order === orderNumber) {
                        dataRow.OrderVolume = volumeData.order_volume ?? null;
                    }
                });
                successCount++;
            }
        } catch (err) {
            console.error('[PSL] Volume fetch error for', orderNumber, err);
            failCount++;
        }

        // Update live progress after each order
        const done = successCount + failCount;
        if (progressText) {
            progressText.textContent = failCount > 0
                ? `${done} / ${total} fetched  (${failCount} failed)`
                : `${done} / ${total} fetched`;
        }
    }

    // Refresh grid with whatever was fetched so far
    if (pslGrid) {
        pslGrid.option('dataSource', [...pslData]);
        pslGrid.refresh();
    }

    // Hide cancel button, restore fetch button
    if (btn) btn.disabled = false;
    if (btnIcon) btnIcon.className = 'fas fa-cube';
    if (cancelBtn) cancelBtn.style.display = 'none';

    // Final progress badge state
    if (cancelled) {
        if (progressIcon) progressIcon.className = 'fas fa-ban';
        if (progressBar) {
            progressBar.style.color = '#6b7280';
            progressBar.style.background = '#f3f4f6';
            progressBar.style.borderColor = '#d1d5db';
        }
        if (progressText) progressText.textContent = `Cancelled — ${successCount} / ${total} fetched`;
    } else if (failCount > 0) {
        if (progressIcon) progressIcon.className = 'fas fa-exclamation-triangle';
        if (progressBar) {
            progressBar.style.color = '#b45309';
            progressBar.style.background = '#fef3c7';
            progressBar.style.borderColor = '#fcd34d';
        }
        if (progressText) progressText.textContent = `${successCount} / ${total} fetched  (${failCount} failed)`;
    } else {
        if (progressIcon) progressIcon.className = 'fas fa-check-circle';
        if (progressBar) {
            progressBar.style.color = '#059669';
            progressBar.style.background = '#d1fae5';
            progressBar.style.borderColor = '#6ee7b7';
        }
        if (progressText) progressText.textContent = `${successCount} / ${total} fetched`;
    }

    console.log(`[PSL] Volume fetch done: ${successCount} ok, ${failCount} failed${cancelled ? ', cancelled' : ''}`);
};

window.cancelPslOrderVolume = function() {
    pslVolumeCancelRequested = true;
    const cancelBtn = document.getElementById('psl-volume-cancel-btn');
    if (cancelBtn) cancelBtn.disabled = true;
    console.log('[PSL] Volume fetch cancel requested');
};

window.showPslVolumeApiInfo = function() {
    const instanceDropdown = document.getElementById('psl-instance-name');
    const currentInstance = instanceDropdown ? instanceDropdown.value : 'PROD';

    const popup = document.createElement('div');
    popup.id = 'psl-volume-api-popup';
    popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10002; display: flex; justify-content: center; align-items: center;';
    popup.innerHTML = `
        <div style="background: white; width: 90%; max-width: 640px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
            <div style="padding: 1.25rem 1.5rem; border-bottom: 2px solid #f3e8ff; display: flex; justify-content: space-between; align-items: center;">
                <h4 style="margin: 0; color: #5b21b6; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-cube"></i> Get Order Volume — API Info
                </h4>
                <button onclick="document.getElementById('psl-volume-api-popup').remove()" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #94a3b8;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div style="padding: 1.25rem 1.5rem; overflow-y: auto; max-height: 70vh;">

                <!-- Endpoint -->
                <div style="background: #fce7f3; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #ec4899;">
                    <div style="font-weight: 600; color: #9d174d; margin-bottom: 0.6rem;">Endpoint</div>
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem;">
                        <span style="background: #fed7aa; color: #9c4221; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">POST</span>
                        <code style="font-size: 11px; color: #4a5568;">TRIPMANAGEMENT/fetchordervolume</code>
                    </div>
                    <code style="background: #edf2f7; padding: 6px 10px; border-radius: 4px; font-size: 10px; word-break: break-all; display: block; margin-top: 0.5rem;">
                        ${PSL_ORDER_VOLUME_API}
                    </code>
                </div>

                <!-- Parameters -->
                <div style="background: #eff6ff; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #3b82f6;">
                    <div style="font-weight: 600; color: #1e40af; margin-bottom: 0.6rem;">Query Parameters</div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                        <tr style="background: #dbeafe;">
                            <th style="padding: 6px 8px; text-align: left; border: 1px solid #bfdbfe;">Parameter</th>
                            <th style="padding: 6px 8px; text-align: left; border: 1px solid #bfdbfe;">Value</th>
                            <th style="padding: 6px 8px; text-align: left; border: 1px solid #bfdbfe;">Source</th>
                        </tr>
                        <tr>
                            <td style="padding: 6px 8px; border: 1px solid #bfdbfe; font-family: monospace;">p_instance_name</td>
                            <td style="padding: 6px 8px; border: 1px solid #bfdbfe; font-weight: 600;">${currentInstance}</td>
                            <td style="padding: 6px 8px; border: 1px solid #bfdbfe;"><span style="background: #c6f6d5; color: #22543d; padding: 2px 6px; border-radius: 4px; font-size: 10px;">Instance dropdown</span></td>
                        </tr>
                        <tr style="background: #eff6ff;">
                            <td style="padding: 6px 8px; border: 1px solid #bfdbfe; font-family: monospace;">source_order_number</td>
                            <td style="padding: 6px 8px; border: 1px solid #bfdbfe; font-style: italic;">e.g. SO-00012345</td>
                            <td style="padding: 6px 8px; border: 1px solid #bfdbfe;"><span style="background: #e9d5ff; color: #6b21a8; padding: 2px 6px; border-radius: 4px; font-size: 10px;">Selected row</span></td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 8px; border: 1px solid #bfdbfe; font-family: monospace;">p_trip_id</td>
                            <td style="padding: 6px 8px; border: 1px solid #bfdbfe; color: #94a3b8;">(empty)</td>
                            <td style="padding: 6px 8px; border: 1px solid #bfdbfe; color: #94a3b8; font-size: 11px;">Not yet in a trip</td>
                        </tr>
                    </table>
                </div>

                <!-- Response Fields -->
                <div style="background: #f0fdf4; padding: 1rem; border-radius: 8px; border-left: 4px solid #22c55e;">
                    <div style="font-weight: 600; color: #166534; margin-bottom: 0.6rem;">Response JSON</div>
                    <pre style="background: #1e293b; color: #e2e8f0; padding: 0.75rem 1rem; border-radius: 6px; font-size: 11px; margin: 0 0 0.75rem 0; overflow-x: auto;">{
  "status": "success",
  "order_volume": 1.702,
  "source_order_number": "78426000275",
  "instance_name": "PROD"
}</pre>
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                        <tr style="background: #dcfce7;">
                            <th style="padding: 6px 8px; text-align: left; border: 1px solid #bbf7d0;">Response Field</th>
                            <th style="padding: 6px 8px; text-align: left; border: 1px solid #bbf7d0;">Grid Column</th>
                        </tr>
                        <tr>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0; font-family: monospace;">order_volume</td>
                            <td style="padding: 6px 8px; border: 1px solid #bbf7d0; color: #7c3aed; font-weight: 600;">Order Volume</td>
                        </tr>
                    </table>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(popup);
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
                        resolve(json && json.status === 'success' ? json : null);
                    } catch (e) {
                        reject(e);
                    }
                }
            });
        } else {
            fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                .then(r => r.json())
                .then(json => resolve(json && json.status === 'success' ? json : null))
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
    fetchPendingShipmentLines();
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
    const f = getPslFilterValues();
    const currentUrl = buildPslFusionUrl(0);

    const optionalBadge = '<span style="background: #e2e8f0; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 10px;">Optional</span>';
    const mandatoryBadge = '<span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;">Mandatory</span>';

    const apiInfo = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <h4 style="margin: 0 0 1rem 0; color: #333; border-bottom: 2px solid #667eea; padding-bottom: 0.5rem;">
                <i class="fas fa-code" style="color: #667eea;"></i> API Information - Pending Shipment Lines
            </h4>

            <!-- Fusion shipmentLines API -->
            <div style="background: #eff6ff; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #3b82f6;">
                <div style="font-weight: 600; color: #1e40af; margin-bottom: 0.5rem;">Oracle Fusion — shipmentLines</div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">Method:</strong>
                    <span style="background: #c6f6d5; color: #22543d; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">GET</span>
                    <span style="margin-left: 0.5rem;"><strong style="color: #4a5568;">Auth:</strong> Fusion credentials via C# backend (<code style="font-size: 10px;">executeOracleFusionGet</code>)</span>
                </div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">Resource:</strong>
                    <code style="background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 11px;">${PSL_FUSION_RESOURCE}</code>
                </div>
                <div style="margin-bottom: 0.5rem;">
                    <strong style="color: #4a5568;">Current URL (offset 0):</strong>
                    <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px; font-size: 10px; word-break: break-all; display: block; margin-top: 4px;">
                        ${currentUrl}
                    </code>
                </div>
                <div>
                    <strong style="color: #4a5568;">Paging:</strong>
                    <span style="font-size: 11px; color: #4a5568;">limit=${PSL_PAGE_SIZE} per call; "Fetch Next 50" increments <code>offset</code> while the response has <code>hasMore=true</code>.</span>
                </div>
            </div>

            <!-- Query Parameters Table -->
            <div style="background: #e6fffa; padding: 1rem; border-radius: 8px; border-left: 4px solid #38b2ac;">
                <div style="font-weight: 600; color: #234e52; margin-bottom: 0.5rem;">q Filter Parameters:</div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <tr style="background: #b2f5ea;">
                        <th style="padding: 6px 8px; text-align: left; border: 1px solid #81e6d9;">Attribute</th>
                        <th style="padding: 6px 8px; text-align: left; border: 1px solid #81e6d9;">Value</th>
                        <th style="padding: 6px 8px; text-align: left; border: 1px solid #81e6d9;">Required</th>
                    </tr>
                    <tr>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-family: monospace;">CreationDate</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-weight: 600;">${f.creationDate ? f.dateOperator + ' ' + f.creationDate : '(not set)'}</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9;">${optionalBadge}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-family: monospace;">OrganizationCode</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-weight: 600;">${f.organization || '(not set)'}</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9;">${mandatoryBadge}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-family: monospace;">OrderType</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-weight: 600;">${f.orderType || '(not set)'}</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9;">${mandatoryBadge}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-family: monospace;">Order</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-weight: 600;">${f.order || '(not set)'}</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9;">${optionalBadge}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-family: monospace;">Item</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-weight: 600;">${f.item || '(not set)'}</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9;">${optionalBadge}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-family: monospace;">LineStatus</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9; font-weight: 600;">${f.lineStatus || '(All)'}</td>
                        <td style="padding: 6px 8px; border: 1px solid #81e6d9;">${optionalBadge}</td>
                    </tr>
                </table>
                <div style="font-size: 11px; color: #4a5568; margin-top: 0.6rem;">
                    <strong>Returned fields:</strong>
                    <code style="background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 10px; word-break: break-all;">${PSL_FUSION_FIELDS}</code>
                </div>
                <div style="font-size: 11px; color: #4a5568; margin-top: 0.4rem;">
                    <strong>Instance:</strong> ${currentInstance} → <code style="font-size: 10px;">${getPslFusionBaseUrl()}</code>
                </div>
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

// ============================================================================
// MONITOR PRINTING - Auto-Print Trip Management
// ============================================================================

// Get API base URL from config
const MONITOR_API_BASE_URL = (typeof API_CONFIG !== 'undefined') ? API_CONFIG.APEX_BASE_URL : '';

// Global variables
let allPrintersForSelection = [];
let currentTripForPrinterSelection = null;
let monitoringTripsData = [];
let monitoringGrid = null;

// ============================================================================
// PRINTER SELECTION MODAL
// ============================================================================

window.showPrinterSelectionModal = async function(tripId, tripDate, orderCount, orders) {
    console.log('[Monitor] Showing printer selection modal for trip:', tripId);

    currentTripForPrinterSelection = {
        tripId: tripId,
        tripDate: tripDate,
        orderCount: orderCount,
        orders: orders
    };

    // Populate modal fields
    document.getElementById('modal-trip-id').textContent = tripId;
    document.getElementById('modal-trip-date').textContent = tripDate;
    document.getElementById('modal-order-count').textContent = `${orderCount} orders`;

    // Load printers
    await loadPrintersForSelection();

    // Show modal
    document.getElementById('printer-selection-modal').style.display = 'flex';
};

window.closePrinterSelectionModal = function() {
    console.log('[Monitor] Closing printer selection modal');

    // Reset toggle if modal was closed without confirmation
    if (currentTripForPrinterSelection) {
        const toggleCheckbox = document.getElementById(
            `autoPrint_${currentTripForPrinterSelection.tripId}_${currentTripForPrinterSelection.tripDate}`
        );
        if (toggleCheckbox) {
            toggleCheckbox.checked = false;
        }
    }

    document.getElementById('printer-selection-modal').style.display = 'none';
    document.getElementById('printer-selection-error').style.display = 'none';
    currentTripForPrinterSelection = null;
};

async function loadPrintersForSelection() {
    try {
        console.log('[Monitor] Loading printers for selection...');

        const data = await callApexAPINew('/printers/all', 'GET');
        allPrintersForSelection = data.items || [];

        const select = document.getElementById('modal-printer-select');
        select.innerHTML = '<option value="">-- Select a printer --</option>';

        allPrintersForSelection.forEach(printer => {
            const option = document.createElement('option');
            option.value = printer.configId;
            option.textContent = `${printer.printerName}${printer.isActive === 'Y' ? ' (Active)' : ''}`;
            if (printer.isActive === 'Y') {
                option.selected = true;
            }
            select.appendChild(option);
        });

        console.log('[Monitor] Loaded', allPrintersForSelection.length, 'printers');
    } catch (error) {
        console.error('[Monitor] Failed to load printers:', error);
        const select = document.getElementById('modal-printer-select');
        select.innerHTML = '<option value="">-- Error loading printers --</option>';
    }
}

window.confirmPrinterSelection = async function() {
    const errorDiv = document.getElementById('printer-selection-error');
    errorDiv.style.display = 'none';

    const printerConfigId = document.getElementById('modal-printer-select').value;

    if (!printerConfigId) {
        errorDiv.textContent = 'Please select a printer';
        errorDiv.style.display = 'block';
        return;
    }

    if (!currentTripForPrinterSelection) {
        errorDiv.textContent = 'Invalid trip data';
        errorDiv.style.display = 'block';
        return;
    }

    const selectedPrinter = allPrintersForSelection.find(p => p.configId == printerConfigId);

    try {
        console.log('[Monitor] Enabling auto-print with printer:', selectedPrinter?.printerName);
        console.log('[Monitor] Orders to save:', currentTripForPrinterSelection.orders);

        // Call APEX API to save the trip with selected printer AND order details
        const response = await callApexAPINew('/monitor-printing/enable', 'POST', {
            tripId: currentTripForPrinterSelection.tripId,
            tripDate: currentTripForPrinterSelection.tripDate,
            orderCount: currentTripForPrinterSelection.orderCount,
            printerConfigId: printerConfigId,
            printerName: selectedPrinter?.printerName || 'Unknown',
            orders: currentTripForPrinterSelection.orders  // ✅ Include order details
        });

        console.log('[Monitor] Auto-print enabled successfully:', response);

        // Update status div
        const statusDiv = document.getElementById(
            `status_${currentTripForPrinterSelection.tripId}_${currentTripForPrinterSelection.tripDate}`
        );
        if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.style.background = '#d4edda';
            statusDiv.style.borderLeft = '3px solid #28a745';
            statusDiv.innerHTML = `✅ Enabled with printer: ${selectedPrinter?.printerName}`;
        }

        // Close modal
        document.getElementById('printer-selection-modal').style.display = 'none';
        currentTripForPrinterSelection = null;

        // Show success message
        alert(`✅ Auto-print enabled successfully!\n\nTrip will be monitored with printer: ${selectedPrinter?.printerName}`);

    } catch (error) {
        console.error('[Monitor] Failed to enable auto-print:', error);
        errorDiv.textContent = 'Failed to enable auto-print: ' + error.message;
        errorDiv.style.display = 'block';
    }
};

// ============================================================================
// MONITOR PRINTING LIST
// ============================================================================

window.loadMonitoringTrips = async function() {
    try {
        const fromDate = document.getElementById('monitor-date-from').value;
        const toDate = document.getElementById('monitor-date-to').value;

        if (!fromDate || !toDate) {
            alert('Please select both From Date and To Date');
            return;
        }

        console.log('[Monitor] Loading monitoring trips from', fromDate, 'to', toDate);

        // Show loading state
        const btn = document.getElementById('load-monitor-trips-btn');
        const icon = document.getElementById('monitor-fetch-icon');
        const text = document.getElementById('monitor-fetch-text');

        btn.disabled = true;
        icon.classList.add('fa-spin');
        text.textContent = 'Loading...';

        // Call APEX API
        const data = await callApexAPINew(`/monitor-printing/list?fromDate=${fromDate}&toDate=${toDate}`, 'GET');

        monitoringTripsData = data.items || [];

        console.log('[Monitor] Loaded', monitoringTripsData.length, 'monitoring trips');

        // Update statistics cards
        updateMonitoringStats(monitoringTripsData);

        // Initialize or update grid
        if (!monitoringGrid) {
            initializeMonitoringGrid();
        } else {
            updateMonitoringGrid();
        }

        // Reset button state
        btn.disabled = false;
        icon.classList.remove('fa-spin');
        text.textContent = 'Load Trips';

    } catch (error) {
        console.error('[Monitor] Failed to load monitoring trips:', error);
        alert('Failed to load monitoring trips: ' + error.message);

        // Reset button state
        const btn = document.getElementById('load-monitor-trips-btn');
        const icon = document.getElementById('monitor-fetch-icon');
        const text = document.getElementById('monitor-fetch-text');
        btn.disabled = false;
        icon.classList.remove('fa-spin');
        text.textContent = 'Load Trips';
    }
};

function updateMonitoringStats(trips) {
    const totalJobs = trips.length;
    const pendingDownload = trips.filter(t => t.status === 'PENDING_DOWNLOAD').length;
    const downloaded = trips.filter(t => t.status === 'DOWNLOADED').length;
    const pendingPrint = trips.filter(t => t.status === 'PENDING_PRINT').length;
    const printed = trips.filter(t => t.status === 'PRINTED').length;
    const failed = trips.filter(t => t.status === 'FAILED').length;

    document.getElementById('stat-total-jobs').textContent = totalJobs;
    document.getElementById('stat-pending-download').textContent = pendingDownload;
    document.getElementById('stat-completed-download').textContent = downloaded;
    document.getElementById('stat-pending-print').textContent = pendingPrint;
    document.getElementById('stat-printed').textContent = printed;
    document.getElementById('stat-failed').textContent = failed;
}

function initializeMonitoringGrid() {
    monitoringGrid = $('#print-jobs-grid').dxDataGrid({
        dataSource: monitoringTripsData,
        showBorders: true,
        showRowLines: true,
        rowAlternationEnabled: true,
        columnAutoWidth: true,
        wordWrapEnabled: false,
        allowColumnResizing: true,
        columnResizingMode: 'widget',
        hoverStateEnabled: true,
        paging: {
            pageSize: 25
        },
        pager: {
            visible: true,
            showPageSizeSelector: true,
            allowedPageSizes: [10, 25, 50, 100],
            showInfo: true
        },
        searchPanel: {
            visible: true,
            width: 240,
            placeholder: 'Search...'
        },
        headerFilter: {
            visible: true
        },
        filterRow: {
            visible: true
        },
        columns: [
            {
                dataField: 'tripId',
                caption: 'Trip ID',
                width: 120,
                fixed: true
            },
            {
                dataField: 'tripDate',
                caption: 'Trip Date',
                dataType: 'date',
                format: 'yyyy-MM-dd',
                width: 120
            },
            {
                dataField: 'orderCount',
                caption: 'Orders',
                width: 80,
                alignment: 'center'
            },
            {
                dataField: 'printerName',
                caption: 'Printer',
                width: 180
            },
            {
                dataField: 'status',
                caption: 'Status',
                width: 140,
                cellTemplate: function(container, options) {
                    const status = options.value || 'PENDING';
                    let badge = '';

                    switch (status) {
                        case 'PENDING_DOWNLOAD':
                            badge = '<span style="background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">⏳ Pending Download</span>';
                            break;
                        case 'DOWNLOADED':
                            badge = '<span style="background: #dbeafe; color: #1e40af; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">📥 Downloaded</span>';
                            break;
                        case 'PENDING_PRINT':
                            badge = '<span style="background: #e0e7ff; color: #3730a3; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">🖨️ Pending Print</span>';
                            break;
                        case 'PRINTED':
                            badge = '<span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">✅ Printed</span>';
                            break;
                        case 'FAILED':
                            badge = '<span style="background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">❌ Failed</span>';
                            break;
                        default:
                            badge = `<span style="background: #f3f4f6; color: #374151; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">${status}</span>`;
                    }

                    container.append(badge);
                }
            },
            {
                dataField: 'enabledDate',
                caption: 'Enabled At',
                dataType: 'datetime',
                format: 'yyyy-MM-dd HH:mm',
                width: 150
            },
            {
                dataField: 'lastUpdated',
                caption: 'Last Updated',
                dataType: 'datetime',
                format: 'yyyy-MM-dd HH:mm',
                width: 150
            },
            {
                caption: 'Actions',
                width: 180,
                cellTemplate: function(container, options) {
                    const data = options.data;

                    const btnContainer = $('<div>').css({
                        display: 'flex',
                        gap: '4px',
                        justifyContent: 'center'
                    });

                    // View Details button
                    const detailsBtn = $('<button>')
                        .addClass('btn btn-sm btn-primary')
                        .css({ fontSize: '11px', padding: '4px 8px' })
                        .html('<i class="fas fa-eye"></i> Details')
                        .attr('title', 'View Trip Details')
                        .on('click', function() {
                            viewTripDetails(data);
                        });

                    // Disable button
                    const disableBtn = $('<button>')
                        .addClass('btn btn-sm btn-secondary')
                        .css({ fontSize: '11px', padding: '4px 8px' })
                        .html('<i class="fas fa-times"></i>')
                        .attr('title', 'Disable Auto-Print')
                        .on('click', function() {
                            disableMonitoringTrip(data.tripId, data.tripDate);
                        });

                    btnContainer.append(detailsBtn);
                    btnContainer.append(disableBtn);
                    container.append(btnContainer);
                }
            }
        ],
        onContentReady: function(e) {
            const count = e.component.totalCount();
            document.getElementById('filtered-count').textContent =
                `${count} trip${count !== 1 ? 's' : ''}`;
        }
    });
}

function updateMonitoringGrid() {
    if (monitoringGrid) {
        monitoringGrid.dxDataGrid('instance').option('dataSource', monitoringTripsData);
        monitoringGrid.dxDataGrid('instance').refresh();
    }
}

async function disableMonitoringTrip(tripId, tripDate) {
    if (!confirm(`Are you sure you want to disable auto-print for Trip ${tripId}?`)) {
        return;
    }

    try {
        console.log('[Monitor] Disabling trip:', tripId, tripDate);

        // Call APEX API to disable
        await callApexAPINew('/monitor-printing/disable', 'POST', {
            tripId: tripId,
            tripDate: tripDate
        });

        console.log('[Monitor] Trip disabled successfully');

        // Reload grid
        await loadMonitoringTrips();

        alert('✅ Auto-print disabled for this trip');

    } catch (error) {
        console.error('[Monitor] Failed to disable trip:', error);
        alert('Failed to disable auto-print: ' + error.message);
    }
}

// ============================================================================
// TAB SWITCHING
// ============================================================================

let currentTripDetails = null;
let tripOrdersGrid = null;

function switchMonitorTab(tabName) {
    console.log('[Monitor] Switching to tab:', tabName);

    // Update tab headers
    const tabItems = document.querySelectorAll('#monitor-tab-header .tab-item');
    tabItems.forEach(item => {
        if (item.getAttribute('data-tab') === tabName) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Update tab content
    const tripPane = document.getElementById('monitor-trips-tab');
    const detailsPane = document.getElementById('monitor-trip-details-tab');

    if (tabName === 'trips') {
        tripPane.classList.add('active');
        detailsPane.classList.remove('active');
    } else if (tabName === 'trip-details') {
        tripPane.classList.remove('active');
        detailsPane.classList.add('active');
    }
}

window.backToTripsTab = function() {
    switchMonitorTab('trips');
};

// ============================================================================
// TRIP DETAILS - ORDER LEVEL
// ============================================================================

async function viewTripDetails(tripData) {
    console.log('[Monitor] Loading trip details for:', tripData);
    console.log('[Monitor] TripId:', tripData.tripId);

    currentTripDetails = tripData;

    // Update title
    document.getElementById('trip-details-title').innerHTML = `
        <i class="fas fa-box"></i> Trip Details: ${tripData.tripId} (${tripData.tripDate})
    `;

    // Switch to details tab
    switchMonitorTab('trip-details');

    // Show loading
    document.getElementById('orders-count').textContent = 'Loading...';

    try {
        // FIXED: Use trip_id parameter instead of monitorId (join is on trip_id, not monitor_id)
        const endpoint = `/monitor-printing/orders?trip_id=${tripData.tripId}`;
        console.log('[Monitor] Calling endpoint:', endpoint);
        console.log('[Monitor] Full URL:', `${MONITOR_API_BASE_URL}${endpoint}`);

        // Call APEX API to get order details
        const data = await callApexAPINew(endpoint, 'GET');

        console.log('[Monitor] Raw API response:', data);

        const orders = data.items || [];
        console.log('[Monitor] Loaded', orders.length, 'orders for trip', tripData.tripId);

        if (orders.length === 0) {
            console.warn('[Monitor] ⚠️ No orders found in response. Check if trip_id', tripData.tripId, 'exists in wms_monitor_printing_details table');
        }

        // Update count
        document.getElementById('orders-count').textContent = `${orders.length} order${orders.length !== 1 ? 's' : ''}`;

        // Always show buttons for easier testing - disable Download All if no orders
        const downloadAllBtn = document.getElementById('download-all-orders-btn');
        const refreshBtn = document.getElementById('refresh-orders-btn');

        if (downloadAllBtn && refreshBtn) {
            downloadAllBtn.style.display = 'inline-block';
            refreshBtn.style.display = 'inline-block';

            // Disable Download All button if no orders
            downloadAllBtn.disabled = orders.length === 0;
            if (orders.length === 0) {
                downloadAllBtn.style.opacity = '0.5';
                downloadAllBtn.style.cursor = 'not-allowed';
            } else {
                downloadAllBtn.style.opacity = '1';
                downloadAllBtn.style.cursor = 'pointer';
            }

            console.log('[Monitor] ✅ Buttons visible - Download All:', orders.length > 0 ? 'enabled' : 'disabled');
        } else {
            console.error('[Monitor] ❌ Buttons not found in DOM!');
        }

        // Initialize or update grid
        if (!tripOrdersGrid) {
            initializeTripOrdersGrid(orders);
        } else {
            updateTripOrdersGrid(orders);
        }

    } catch (error) {
        console.error('[Monitor] ❌ Failed to load trip details:', error);
        console.error('[Monitor] Error details:', {
            message: error.message,
            stack: error.stack,
            tripId: tripData.tripId
        });

        document.getElementById('orders-count').textContent = 'Error loading orders';

        // Show buttons even on error
        const downloadAllBtn = document.getElementById('download-all-orders-btn');
        const refreshBtn = document.getElementById('refresh-orders-btn');

        if (downloadAllBtn && refreshBtn) {
            downloadAllBtn.style.display = 'inline-block';
            refreshBtn.style.display = 'inline-block';
            downloadAllBtn.disabled = true;
            downloadAllBtn.style.opacity = '0.5';
            console.log('[Monitor] ✅ Buttons shown (error state)');
        }

        // Show detailed error to user
        alert(`Failed to load trip details for Trip ${tripData.tripId}:\n\n` +
              `Error: ${error.message}\n\n` +
              `Trip ID: ${tripData.tripId}\n\n` +
              `Please check:\n` +
              `1. Browser console (F12) for detailed logs\n` +
              `2. API endpoint is accessible\n` +
              `3. Trip ID '${tripData.tripId}' exists in wms_monitor_printing_details table`);
    }
}

function initializeTripOrdersGrid(orders) {
    tripOrdersGrid = $('#trip-orders-grid').dxDataGrid({
        dataSource: orders,
        showBorders: true,
        showRowLines: true,
        rowAlternationEnabled: true,
        columnAutoWidth: true,
        wordWrapEnabled: false,
        allowColumnResizing: true,
        columnResizingMode: 'widget',
        hoverStateEnabled: true,
        paging: {
            pageSize: 50
        },
        pager: {
            visible: true,
            showPageSizeSelector: true,
            allowedPageSizes: [25, 50, 100, 200],
            showInfo: true
        },
        searchPanel: {
            visible: true,
            width: 240,
            placeholder: 'Search orders...'
        },
        headerFilter: {
            visible: true
        },
        filterRow: {
            visible: true
        },
        export: {
            enabled: true,
            fileName: `Trip_${currentTripDetails?.tripId}_Orders`
        },
        columns: [
            {
                caption: 'Actions',
                width: 180,
                fixed: true,
                cellTemplate: function(container, options) {
                    const rowData = options.data;
                    const pdfStatus = rowData.pdfStatus || 'PENDING';

                    // Preview button
                    const previewBtn = $('<button>')
                        .addClass('btn btn-sm btn-info')
                        .css({
                            marginRight: '4px',
                            fontSize: '11px',
                            padding: '4px 8px',
                            cursor: pdfStatus === 'DOWNLOADED' ? 'pointer' : 'not-allowed',
                            opacity: pdfStatus === 'DOWNLOADED' ? '1' : '0.5'
                        })
                        .html('<i class="fas fa-eye"></i>')
                        .attr('title', pdfStatus === 'DOWNLOADED' ? 'Preview PDF' : 'PDF not available')
                        .prop('disabled', pdfStatus !== 'DOWNLOADED')
                        .on('click', function(e) {
                            e.stopPropagation();
                            if (pdfStatus === 'DOWNLOADED') {
                                previewOrderPDF(rowData);
                            }
                        });

                    // Download button
                    const downloadBtn = $('<button>')
                        .addClass('btn btn-sm btn-primary')
                        .css({
                            fontSize: '11px',
                            padding: '4px 8px'
                        })
                        .html('<i class="fas fa-download"></i>')
                        .attr('title', 'Download PDF')
                        .on('click', function(e) {
                            e.stopPropagation();
                            downloadOrderPDF(rowData);
                        });

                    container.append(previewBtn).append(downloadBtn);
                }
            },
            {
                dataField: 'orderNumber',
                caption: 'Order Number',
                width: 140
            },
            {
                dataField: 'customerName',
                caption: 'Customer Name',
                width: 200
            },
            {
                dataField: 'accountNumber',
                caption: 'Account Number',
                width: 140
            },
            {
                dataField: 'orderDate',
                caption: 'Order Date',
                dataType: 'date',
                format: 'yyyy-MM-dd',
                width: 120
            },
            {
                dataField: 'pdfStatus',
                caption: 'PDF Status',
                width: 140,
                cellTemplate: function(container, options) {
                    const status = options.value || 'PENDING';
                    let badge = '';

                    switch (status) {
                        case 'PENDING':
                            badge = '<span style="background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">⏳ Pending</span>';
                            break;
                        case 'DOWNLOADING':
                            badge = '<span style="background: #dbeafe; color: #1e40af; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">📥 Downloading</span>';
                            break;
                        case 'DOWNLOADED':
                            badge = '<span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">✅ Downloaded</span>';
                            break;
                        case 'FAILED':
                            badge = '<span style="background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">❌ Failed</span>';
                            break;
                        default:
                            badge = `<span style="background: #f3f4f6; color: #374151; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">${status}</span>`;
                    }

                    container.append(badge);
                }
            },
            {
                dataField: 'printStatus',
                caption: 'Print Status',
                width: 140,
                cellTemplate: function(container, options) {
                    const status = options.value || 'PENDING';
                    let badge = '';

                    switch (status) {
                        case 'PENDING':
                            badge = '<span style="background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">⏳ Pending</span>';
                            break;
                        case 'PRINTING':
                            badge = '<span style="background: #e0e7ff; color: #3730a3; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">🖨️ Printing</span>';
                            break;
                        case 'PRINTED':
                            badge = '<span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">✅ Printed</span>';
                            break;
                        case 'FAILED':
                            badge = '<span style="background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">❌ Failed</span>';
                            break;
                        default:
                            badge = `<span style="background: #f3f4f6; color: #374151; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">${status}</span>`;
                    }

                    container.append(badge);
                }
            },
            {
                dataField: 'pdfPath',
                caption: 'PDF Path',
                width: 200,
                visible: false
            },
            {
                dataField: 'downloadAttempts',
                caption: 'Download Attempts',
                width: 120,
                alignment: 'center'
            },
            {
                dataField: 'printAttempts',
                caption: 'Print Attempts',
                width: 120,
                alignment: 'center'
            },
            {
                dataField: 'lastError',
                caption: 'Last Error',
                width: 250,
                cellTemplate: function(container, options) {
                    const error = options.value;
                    if (error) {
                        container.append(
                            $('<span>')
                                .css({ color: '#dc3545', fontSize: '12px' })
                                .text(error)
                                .attr('title', error)
                        );
                    } else {
                        container.append('-');
                    }
                }
            },
            {
                dataField: 'lastUpdated',
                caption: 'Last Updated',
                dataType: 'datetime',
                format: 'yyyy-MM-dd HH:mm',
                width: 150
            }
        ]
    });
}

function updateTripOrdersGrid(orders) {
    if (tripOrdersGrid) {
        tripOrdersGrid.dxDataGrid('instance').option('dataSource', orders);
        tripOrdersGrid.dxDataGrid('instance').refresh();
    }
}

// ============================================================================
// PDF DOWNLOAD AND PREVIEW FUNCTIONS
// ============================================================================

async function downloadOrderPDF(orderData) {
    console.log('[Monitor] Downloading PDF for order:', orderData.orderNumber);

    try {
        // Update status to DOWNLOADING
        updateOrderStatus(orderData.detailId, 'DOWNLOADING', null);

        // Call C# to download PDF from Oracle Fusion
        const response = await new Promise((resolve, reject) => {
            sendMessageToCSharp({
                action: 'downloadOrderPdf',
                orderNumber: orderData.orderNumber,
                tripId: currentTripDetails.tripId,
                tripDate: currentTripDetails.tripDate
            }, function(error, response) {
                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(response);
                }
            });
        });

        if (response.success && response.filePath) {
            // Update status to DOWNLOADED
            updateOrderStatus(orderData.detailId, 'DOWNLOADED', null, response.filePath);

            console.log('[Monitor] ✅ PDF downloaded successfully to:', response.filePath);

            // Show success message
            alert(`✓ PDF downloaded successfully!\n\nSaved to: ${response.filePath}`);
        } else {
            throw new Error(response.message || 'Failed to download PDF');
        }

    } catch (error) {
        console.error('[Monitor] ❌ Failed to download PDF:', error);
        updateOrderStatus(orderData.detailId, 'FAILED', error.message);
        alert(`Failed to download PDF for order ${orderData.orderNumber}:\n${error.message}`);
    }
}

async function previewOrderPDF(orderData) {
    console.log('[Monitor] Previewing PDF for order:', orderData.orderNumber);

    if (!orderData.pdfPath) {
        alert('PDF file path not available. Please download the PDF first.');
        return;
    }

    try {
        // Open PDF in default viewer (uses app.js viewPdf function)
        // Local file paths can't be loaded in iframe due to security restrictions
        // So we open in default PDF viewer instead
        if (typeof viewPdf === 'function') {
            viewPdf(orderData.pdfPath);
        } else {
            // Fallback: open as file:// URL
            window.open('file:///' + orderData.pdfPath.replace(/\\/g, '/'), '_blank');
        }

        console.log('[Monitor] ✅ Opened PDF:', orderData.pdfPath);

    } catch (error) {
        console.error('[Monitor] ❌ Failed to preview PDF:', error);
        alert(`Failed to preview PDF: ${error.message}`);
    }
}

async function downloadAllOrdersPDF() {
    console.log('[Monitor] Downloading all orders PDF for trip:', currentTripDetails.tripId);

    if (!currentTripDetails) {
        alert('No trip selected');
        return;
    }

    const confirmed = confirm(`Download PDFs for all orders in trip ${currentTripDetails.tripId}?\n\nThis will download ${currentTripDetails.orderCount} order PDFs.`);

    if (!confirmed) {
        return;
    }

    try {
        // Get all orders from grid
        const gridInstance = tripOrdersGrid.dxDataGrid('instance');
        const allOrders = gridInstance.option('dataSource');

        console.log(`[Monitor] Starting download for ${allOrders.length} orders`);

        // Download each order PDF with delay
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < allOrders.length; i++) {
            const order = allOrders[i];

            console.log(`[Monitor] Downloading ${i + 1}/${allOrders.length}: ${order.orderNumber}`);

            try {
                await downloadOrderPDF(order);
                successCount++;

                // Delay between downloads to avoid overwhelming the server
                if (i < allOrders.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.error(`[Monitor] Failed to download order ${order.orderNumber}:`, error);
                failCount++;
            }
        }

        // Refresh grid to show updated statuses
        await refreshOrdersStatus();

        alert(`Download complete!\n\nSuccess: ${successCount}\nFailed: ${failCount}\nTotal: ${allOrders.length}`);

    } catch (error) {
        console.error('[Monitor] ❌ Failed to download all orders:', error);
        alert(`Failed to download all orders: ${error.message}`);
    }
}

async function refreshOrdersStatus() {
    console.log('[Monitor] Refreshing orders status for trip:', currentTripDetails.tripId);

    if (!currentTripDetails) {
        return;
    }

    try {
        // Reload trip details
        await viewTripDetails(currentTripDetails);
        console.log('[Monitor] ✅ Orders status refreshed');
    } catch (error) {
        console.error('[Monitor] ❌ Failed to refresh orders status:', error);
        alert(`Failed to refresh orders status: ${error.message}`);
    }
}

function updateOrderStatus(detailId, pdfStatus, errorMessage, pdfPath) {
    // Update the grid data
    if (tripOrdersGrid) {
        const gridInstance = tripOrdersGrid.dxDataGrid('instance');
        const dataSource = gridInstance.option('dataSource');

        const orderIndex = dataSource.findIndex(o => o.detailId === detailId);

        if (orderIndex >= 0) {
            dataSource[orderIndex].pdfStatus = pdfStatus;

            if (errorMessage) {
                dataSource[orderIndex].errorMessage = errorMessage;
            }

            if (pdfPath) {
                dataSource[orderIndex].pdfPath = pdfPath;
            }

            // Refresh grid
            gridInstance.option('dataSource', dataSource);
            gridInstance.refresh();
        }
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Set default dates (last 7 days) when page loads
window.addEventListener('DOMContentLoaded', function() {
    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    document.getElementById('monitor-date-from').value = formatDate(lastWeek);
    document.getElementById('monitor-date-to').value = formatDate(today);

    // Setup collapse toggle for monitor parameters
    const toggle = document.getElementById('monitor-parameters-toggle');
    const content = document.getElementById('monitor-parameters-content');
    const icon = document.getElementById('monitor-collapse-icon');

    if (toggle && content && icon) {
        toggle.addEventListener('click', function() {
            content.classList.toggle('collapsed');
            icon.classList.toggle('collapsed');
        });
    }

    // Setup tab switching for monitor tabs
    const monitorTabItems = document.querySelectorAll('#monitor-tab-header .tab-item');
    monitorTabItems.forEach(item => {
        item.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            if (tabName === 'trips') {
                switchMonitorTab('trips');
            } else if (tabName === 'trip-details') {
                // Only allow switching to trip-details if we have data
                if (currentTripDetails) {
                    switchMonitorTab('trip-details');
                } else {
                    alert('Please select a trip first to view details');
                }
            }
        });
    });
});

// ============================================================================
// DIAGNOSTIC FUNCTIONS
// ============================================================================

window.runDiagnosticCheckButtons = function() {
    const status = document.getElementById('diagnostic-status');
    status.textContent = 'Checking...';
    status.style.color = '#ffc107';

    const downloadBtn = document.getElementById('download-all-orders-btn');
    const refreshBtn = document.getElementById('refresh-orders-btn');

    const results = {
        'Download All Button': downloadBtn ? {
            exists: true,
            display: downloadBtn.style.display,
            visible: downloadBtn.offsetParent !== null,
            disabled: downloadBtn.disabled,
            innerHTML: downloadBtn.innerHTML.substring(0, 50)
        } : { exists: false },
        'Refresh Button': refreshBtn ? {
            exists: true,
            display: refreshBtn.style.display,
            visible: refreshBtn.offsetParent !== null,
            disabled: refreshBtn.disabled
        } : { exists: false }
    };

    console.log('=== BUTTON DIAGNOSTIC ===');
    console.table(results);
    console.log('Full Download Button:', downloadBtn);
    console.log('Full Refresh Button:', refreshBtn);

    alert('Button Diagnostic Complete!\n\nDownload All: ' + (downloadBtn ? 'EXISTS' : 'NOT FOUND') +
          '\nRefresh: ' + (refreshBtn ? 'EXISTS' : 'NOT FOUND') +
          '\n\nCheck console (F12) for details');

    status.textContent = 'Check Complete';
    status.style.color = '#00ff88';
};

window.runDiagnosticShowButtons = function() {
    const status = document.getElementById('diagnostic-status');
    status.textContent = 'Forcing...';
    status.style.color = '#ffc107';

    const downloadBtn = document.getElementById('download-all-orders-btn');
    const refreshBtn = document.getElementById('refresh-orders-btn');

    if (downloadBtn) {
        downloadBtn.style.display = 'inline-block';
        downloadBtn.style.visibility = 'visible';
        downloadBtn.style.opacity = '1';
        downloadBtn.disabled = false;
        console.log('✅ Download All button forced visible');
    } else {
        console.error('❌ Download All button not found');
    }

    if (refreshBtn) {
        refreshBtn.style.display = 'inline-block';
        refreshBtn.style.visibility = 'visible';
        refreshBtn.style.opacity = '1';
        console.log('✅ Refresh button forced visible');
    } else {
        console.error('❌ Refresh button not found');
    }

    alert('Buttons forced visible!\n\nDownload All: ' + (downloadBtn ? 'SHOWN' : 'NOT FOUND') +
          '\nRefresh: ' + (refreshBtn ? 'SHOWN' : 'NOT FOUND'));

    status.textContent = 'Buttons Forced';
    status.style.color = '#00ff88';
};

window.runDiagnosticCheckGrid = function() {
    const status = document.getElementById('diagnostic-status');
    status.textContent = 'Checking...';
    status.style.color = '#ffc107';

    console.log('=== GRID DIAGNOSTIC ===');
    console.log('tripOrdersGrid:', tripOrdersGrid);
    console.log('currentTripDetails:', currentTripDetails);

    if (tripOrdersGrid) {
        const gridInstance = tripOrdersGrid.dxDataGrid('instance');
        const dataSource = gridInstance.option('dataSource');
        console.log('Grid DataSource:', dataSource);
        console.log('Grid Row Count:', dataSource ? dataSource.length : 0);
    }

    const gridElement = document.getElementById('trip-orders-grid');
    console.log('Grid Element:', gridElement);
    console.log('Grid Element Visible:', gridElement ? gridElement.offsetParent !== null : false);

    alert('Grid Diagnostic Complete!\n\nGrid Initialized: ' + (tripOrdersGrid ? 'YES' : 'NO') +
          '\nCurrent Trip: ' + (currentTripDetails ? currentTripDetails.tripId : 'NONE') +
          '\n\nCheck console for details');

    status.textContent = 'Grid Checked';
    status.style.color = '#00ff88';
};

window.runDiagnosticCheckTab = function() {
    const status = document.getElementById('diagnostic-status');
    status.textContent = 'Checking...';
    status.style.color = '#ffc107';

    const tripDetailsTab = document.getElementById('monitor-trip-details-tab');
    const tripsTab = document.getElementById('monitor-trips-tab');

    console.log('=== TAB VISIBILITY DIAGNOSTIC ===');
    console.log('Trip Details Tab:', {
        exists: !!tripDetailsTab,
        display: tripDetailsTab?.style.display,
        className: tripDetailsTab?.className,
        visible: tripDetailsTab?.offsetParent !== null
    });
    console.log('Trips Tab:', {
        exists: !!tripsTab,
        display: tripsTab?.style.display,
        className: tripsTab?.className,
        visible: tripsTab?.offsetParent !== null
    });

    alert('Tab Diagnostic Complete!\n\nTrip Details Tab Visible: ' +
          (tripDetailsTab?.offsetParent !== null ? 'YES' : 'NO') +
          '\n\nCheck console for details');

    status.textContent = 'Tab Checked';
    status.style.color = '#00ff88';
};

window.runDiagnosticShowConsole = function() {
    const status = document.getElementById('diagnostic-status');
    status.textContent = 'Logging...';
    status.style.color = '#ffc107';

    console.log('╔════════════════════════════════════════╗');
    console.log('║     COMPLETE DIAGNOSTIC REPORT        ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');

    runDiagnosticCheckButtons();
    runDiagnosticCheckGrid();
    runDiagnosticCheckTab();

    console.log('');
    console.log('Current Trip Details:', currentTripDetails);
    console.log('Trip Orders Grid:', tripOrdersGrid);
    console.log('');
    console.log('All Monitor Variables:', {
        currentTripDetails,
        tripOrdersGrid,
        currentMonitoringTrips,
        MONITOR_API_BASE_URL
    });

    status.textContent = 'All Info Logged';
    status.style.color = '#00ff88';
};

window.toggleDiagnosticToolbar = function() {
    const toolbar = document.getElementById('diagnostic-toolbar');
    if (toolbar) {
        toolbar.style.display = toolbar.style.display === 'none' ? 'flex' : 'none';
    }
};

console.log('[Monitor] monitor-printing.js loaded');

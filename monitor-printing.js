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
                dataField: 'orderNumber',
                caption: 'Order Number',
                width: 140,
                fixed: true
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

console.log('[Monitor] monitor-printing.js loaded');

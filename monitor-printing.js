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

        // Call APEX API to save the trip with selected printer
        const response = await callApexAPINew('/monitor-printing/enable', 'POST', {
            tripId: currentTripForPrinterSelection.tripId,
            tripDate: currentTripForPrinterSelection.tripDate,
            orderCount: currentTripForPrinterSelection.orderCount,
            printerConfigId: printerConfigId,
            printerName: selectedPrinter?.printerName || 'Unknown'
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
                width: 120,
                cellTemplate: function(container, options) {
                    const data = options.data;

                    const btnContainer = $('<div>').css({
                        display: 'flex',
                        gap: '4px',
                        justifyContent: 'center'
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

                    btnContainer.append(disableBtn);
                    container.append(btnContainer);
                }
            }
        ],
        onContentReady: function(e) {
            document.getElementById('filtered-count').textContent =
                `${e.component.totalCount()} jobs`;
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
});

console.log('[Monitor] monitor-printing.js loaded');

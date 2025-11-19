// ============================================================================
// TRIP DETAILS MANAGEMENT
// ============================================================================

console.log('[Trip Details] Loading...');

// Global variables
let tripDetailsData = null;
let tripOrdersGrid = null;
let pendingOrdersGrid = null;
let pendingOrdersData = [];
let tripOrdersData = [];

// API Endpoints
const PENDING_ORDERS_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/getpendingorders';
const ADD_TO_TRIP_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/addtotrip'; // To be provided

// ============================================================================
// OPEN TRIP DETAILS PAGE
// ============================================================================

window.openTripDetailsPage = function(tripData) {
    console.log('[Trip Details] Opening page with trip data:', tripData);

    // Store trip data
    tripDetailsData = tripData;

    // Hide all page content
    document.querySelectorAll('.page-content').forEach(page => {
        page.style.display = 'none';
    });

    // Show trip details page
    const tripDetailsPage = document.getElementById('trip-details-management');
    if (tripDetailsPage) {
        tripDetailsPage.style.display = 'block';
    }

    // Populate trip header
    populateTripHeader(tripData);

    // Initialize grids
    initializeTripOrdersGrid();

    // Load trip orders (initially empty)
    loadTripOrders();

    console.log('[Trip Details] Page opened');
};

// ============================================================================
// POPULATE TRIP HEADER
// ============================================================================

function populateTripHeader(tripData) {
    console.log('[Trip Details] Populating header...');

    document.getElementById('trip-detail-id').textContent = tripData.trip_id || '-';
    document.getElementById('trip-detail-date').textContent = tripData.trip_date || '-';
    document.getElementById('trip-detail-vehicle').textContent = tripData.trip_lorry || tripData.vehicle || '-';
    document.getElementById('trip-detail-loading-bay').textContent = tripData.trip_loading_bay || tripData.loading_bay || '-';
    document.getElementById('trip-detail-priority').textContent = tripData.trip_priority || tripData.priority || '-';
    document.getElementById('trip-detail-status').textContent = tripData.status || 'DRAFT';

    console.log('[Trip Details] Header populated');
}

// ============================================================================
// INITIALIZE TRIP ORDERS GRID
// ============================================================================

function initializeTripOrdersGrid() {
    console.log('[Trip Details] Initializing trip orders grid...');

    try {
        tripOrdersGrid = $('#trip-orders-grid').dxDataGrid({
            dataSource: [],
            showBorders: true,
            showRowLines: true,
            showColumnLines: true,
            rowAlternationEnabled: true,
            columnAutoWidth: true,
            allowColumnReordering: true,
            allowColumnResizing: true,
            hoverStateEnabled: true,
            filterRow: {
                visible: true,
                applyFilter: 'auto'
            },
            searchPanel: {
                visible: true,
                width: 240,
                placeholder: 'Search orders...'
            },
            paging: {
                pageSize: 20
            },
            pager: {
                visible: true,
                showPageSizeSelector: true,
                allowedPageSizes: [10, 20, 50, 100],
                showInfo: true
            },
            columns: [
                {
                    dataField: 'source_order_number',
                    caption: 'Order Number',
                    width: 150,
                    fixed: true
                },
                {
                    dataField: 'account_number',
                    caption: 'Account',
                    width: 120
                },
                {
                    dataField: 'account_name',
                    caption: 'Customer Name',
                    width: 250
                },
                {
                    dataField: 'order_date',
                    caption: 'Order Date',
                    width: 120,
                    dataType: 'date',
                    format: 'yyyy-MM-dd'
                },
                {
                    dataField: 'line_status',
                    caption: 'Status',
                    width: 120,
                    cellTemplate: function(container, options) {
                        const status = options.value || 'Unknown';
                        let badgeClass = 'status-pending';
                        if (status === 'AWAIT_SHIP') badgeClass = 'status-pending';
                        container.append(
                            $('<span>')
                                .addClass(`status-badge ${badgeClass}`)
                                .text(status)
                        );
                    }
                },
                {
                    dataField: 'salesrep_name',
                    caption: 'Sales Rep',
                    width: 150
                },
                {
                    dataField: 'order_type_code',
                    caption: 'Order Type',
                    width: 120
                },
                {
                    caption: 'Actions',
                    width: 100,
                    cellTemplate: function(container, options) {
                        const removeBtn = $('<button>')
                            .addClass('grid-action-btn btn-retry')
                            .html('<i class="fas fa-trash"></i>')
                            .attr('title', 'Remove from Trip')
                            .css('background', '#dc3545')
                            .on('click', function() {
                                removeOrderFromTrip(options.data);
                            });

                        container.append(removeBtn);
                    },
                    allowFiltering: false,
                    allowSorting: false
                }
            ],
            onContentReady: function(e) {
                console.log('[Trip Details] Orders grid ready, row count:', e.component.totalCount());
                updateOrdersCount();
            }
        }).dxDataGrid('instance');

        console.log('[Trip Details] Trip orders grid initialized');
    } catch (error) {
        console.error('[Trip Details] Error initializing trip orders grid:', error);
    }
}

// ============================================================================
// LOAD TRIP ORDERS
// ============================================================================

function loadTripOrders() {
    console.log('[Trip Details] Loading trip orders...');

    // For now, start with empty array
    // Later this will call API to get existing trip orders
    tripOrdersData = [];

    if (tripOrdersGrid) {
        tripOrdersGrid.option('dataSource', tripOrdersData);
    }

    updateOrdersCount();
}

function updateOrdersCount() {
    const count = tripOrdersData.length;
    const countDisplay = document.getElementById('trip-orders-count');
    if (countDisplay) {
        countDisplay.textContent = `${count} order${count !== 1 ? 's' : ''}`;
    }
}

// ============================================================================
// OPEN ADD ORDERS MODAL
// ============================================================================

window.openAddOrdersModal = function() {
    console.log('[Trip Details] Opening add orders modal...');

    const modal = document.getElementById('add-orders-modal');
    if (modal) {
        modal.style.display = 'flex';

        // Initialize pending orders grid if not done
        if (!pendingOrdersGrid) {
            initializePendingOrdersGrid();
        }

        // Load pending orders
        loadPendingOrders();
    }
};

window.closeAddOrdersModal = function() {
    const modal = document.getElementById('add-orders-modal');
    if (modal) {
        modal.style.display = 'none';

        // Clear selection
        if (pendingOrdersGrid) {
            pendingOrdersGrid.clearSelection();
        }
    }
};

// ============================================================================
// INITIALIZE PENDING ORDERS GRID
// ============================================================================

function initializePendingOrdersGrid() {
    console.log('[Trip Details] Initializing pending orders grid...');

    try {
        pendingOrdersGrid = $('#pending-orders-grid').dxDataGrid({
            dataSource: [],
            showBorders: true,
            showRowLines: true,
            showColumnLines: true,
            rowAlternationEnabled: true,
            columnAutoWidth: true,
            allowColumnReordering: true,
            allowColumnResizing: true,
            hoverStateEnabled: true,
            selection: {
                mode: 'multiple',
                showCheckBoxesMode: 'always'
            },
            filterRow: {
                visible: true,
                applyFilter: 'auto'
            },
            searchPanel: {
                visible: true,
                width: 300,
                placeholder: 'Search orders...'
            },
            paging: {
                pageSize: 20
            },
            pager: {
                visible: true,
                showPageSizeSelector: true,
                allowedPageSizes: [10, 20, 50, 100],
                showInfo: true
            },
            columns: [
                {
                    dataField: 'source_order_number',
                    caption: 'Order Number',
                    width: 150
                },
                {
                    dataField: 'account_number',
                    caption: 'Account',
                    width: 100
                },
                {
                    dataField: 'account_name',
                    caption: 'Customer Name',
                    width: 250
                },
                {
                    dataField: 'order_date',
                    caption: 'Order Date',
                    width: 120,
                    dataType: 'date',
                    format: 'yyyy-MM-dd'
                },
                {
                    dataField: 'line_status',
                    caption: 'Status',
                    width: 120,
                    cellTemplate: function(container, options) {
                        const status = options.value || 'Unknown';
                        container.append(
                            $('<span>')
                                .addClass('status-badge status-pending')
                                .text(status)
                        );
                    }
                },
                {
                    dataField: 'salesrep_name',
                    caption: 'Sales Rep',
                    width: 150
                },
                {
                    dataField: 'order_type_code',
                    caption: 'Order Type',
                    width: 120
                },
                {
                    dataField: 'instance',
                    caption: 'Instance',
                    width: 80
                }
            ],
            onSelectionChanged: function(e) {
                const selectedCount = e.selectedRowsData.length;
                document.getElementById('selected-orders-count').textContent = selectedCount;
                console.log('[Trip Details] Selected orders:', selectedCount);
            },
            onContentReady: function(e) {
                console.log('[Trip Details] Pending orders grid ready, row count:', e.component.totalCount());
            }
        }).dxDataGrid('instance');

        console.log('[Trip Details] Pending orders grid initialized');
    } catch (error) {
        console.error('[Trip Details] Error initializing pending orders grid:', error);
    }
}

// ============================================================================
// LOAD PENDING ORDERS
// ============================================================================

window.loadPendingOrders = async function() {
    console.log('[Trip Details] Loading pending orders from API...');

    try {
        if (window.chrome && window.chrome.webview) {
            // WebView2 environment
            sendMessageToCSharp({
                action: 'executeGet',
                fullUrl: PENDING_ORDERS_API
            }, function(error, data) {
                if (error) {
                    console.error('[Trip Details] Error loading pending orders:', error);
                    alert('Error loading pending orders: ' + error);
                } else {
                    try {
                        const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
                        handlePendingOrdersData(jsonData);
                    } catch (parseError) {
                        console.error('[Trip Details] Error parsing response:', parseError);
                        alert('Error parsing pending orders data: ' + parseError.message);
                    }
                }
            });
        } else {
            // Fallback for browser testing
            const response = await fetch(PENDING_ORDERS_API, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            handlePendingOrdersData(data);
        }
    } catch (error) {
        console.error('[Trip Details] Error loading pending orders:', error);
        alert('Error loading pending orders: ' + error.message);
    }
};

function handlePendingOrdersData(data) {
    try {
        pendingOrdersData = data.items || [];

        // Filter out orders that are already added to trip
        const availableOrders = pendingOrdersData.filter(order => {
            return order.added_to_trip !== 'YES';
        });

        console.log('[Trip Details] Loaded', pendingOrdersData.length, 'pending orders,', availableOrders.length, 'available');

        // Update grid
        if (pendingOrdersGrid) {
            pendingOrdersGrid.option('dataSource', availableOrders);
        }

        // Update count
        document.getElementById('pending-orders-count').textContent = availableOrders.length;
    } catch (error) {
        console.error('[Trip Details] Error processing pending orders data:', error);
        alert('Error processing pending orders data: ' + error.message);
    }
}

// ============================================================================
// ADD SELECTED ORDERS TO TRIP
// ============================================================================

window.addSelectedOrdersToTrip = async function() {
    console.log('[Trip Details] Adding selected orders to trip...');

    if (!pendingOrdersGrid) {
        alert('Grid not initialized');
        return;
    }

    const selectedOrders = pendingOrdersGrid.getSelectedRowsData();

    if (selectedOrders.length === 0) {
        alert('Please select at least one order');
        return;
    }

    console.log('[Trip Details] Selected orders:', selectedOrders);

    // Prepare data for POST
    const ordersToAdd = selectedOrders.map(order => ({
        trip_id: tripDetailsData.trip_id,
        order_number: order.source_order_number,
        account_number: order.account_number,
        account_name: order.account_name,
        order_date: order.order_date,
        salesrep_name: order.salesrep_name
    }));

    console.log('[Trip Details] Orders to add:', ordersToAdd);

    // TODO: Call POST API to add orders to trip
    // For now, just add to local grid
    alert(`Ready to add ${selectedOrders.length} order(s) to trip!\n\n(POST API integration pending)\n\nSelected orders:\n` + selectedOrders.map(o => o.source_order_number).join(', '));

    // Add to trip orders grid
    tripOrdersData = [...tripOrdersData, ...selectedOrders];
    if (tripOrdersGrid) {
        tripOrdersGrid.option('dataSource', tripOrdersData);
    }

    updateOrdersCount();
    closeAddOrdersModal();
};

// ============================================================================
// REMOVE ORDER FROM TRIP
// ============================================================================

function removeOrderFromTrip(order) {
    if (!confirm(`Remove order ${order.source_order_number} from trip?`)) {
        return;
    }

    console.log('[Trip Details] Removing order from trip:', order);

    // Remove from local data
    tripOrdersData = tripOrdersData.filter(o => o.source_order_number !== order.source_order_number);

    // Update grid
    if (tripOrdersGrid) {
        tripOrdersGrid.option('dataSource', tripOrdersData);
    }

    updateOrdersCount();

    // TODO: Call DELETE API
    alert('Order removed from trip!\n\n(DELETE API integration pending)');
}

// ============================================================================
// GO BACK TO TRIP MANAGEMENT
// ============================================================================

window.goBackToTripManagement = function() {
    console.log('[Trip Details] Going back to trip management...');

    // Hide trip details page
    const tripDetailsPage = document.getElementById('trip-details-management');
    if (tripDetailsPage) {
        tripDetailsPage.style.display = 'none';
    }

    // Show trip management page
    const tripManagementPage = document.getElementById('trip-management');
    if (tripManagementPage) {
        tripManagementPage.style.display = 'block';

        // Optionally refresh trips grid
        if (typeof window.fetchTrips === 'function') {
            window.fetchTrips();
        }
    }

    // Reset trip details data
    tripDetailsData = null;
    tripOrdersData = [];
};

console.log('[Trip Details] ✅ Module loaded');

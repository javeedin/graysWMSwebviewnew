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
// HELPER FUNCTION FOR TRIP MANAGEMENT
// ============================================================================

// Allow Trip Management to set trip data before opening Add Orders modal
window.setTripDetailsDataForModal = function(tripData) {
    console.log('[Trip Details] Setting trip data for modal:', tripData);
    tripDetailsData = tripData;
};

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

    // Update status badge
    const status = tripData.status || 'DRAFT';
    const statusBadge = document.getElementById('trip-detail-status-badge');
    if (statusBadge) {
        statusBadge.textContent = status;
        // Update badge color based on status
        statusBadge.className = 'status-badge';
        if (status === 'DRAFT') statusBadge.classList.add('status-pending');
        else if (status === 'READY') statusBadge.classList.add('status-processing');
        else if (status === 'IN_PROGRESS') statusBadge.classList.add('status-processing');
        else if (status === 'COMPLETED') statusBadge.classList.add('status-completed');
        else if (status === 'CANCELLED') statusBadge.classList.add('status-cancelled');
    }

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
                showCheckBoxesMode: 'always',
                allowSelectAll: true,
                selectAllMode: 'page',
                deferred: false
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

    // Get current instance from global selector
    const currentInstance = localStorage.getItem('fusionInstance') ||
                           document.getElementById('current-instance-display')?.textContent ||
                           'PROD';

    console.log('[Trip Details] Loading orders for instance:', currentInstance);

    // Add instance parameter to API URL
    const apiUrl = `${PENDING_ORDERS_API}?instance=${currentInstance}`;

    try {
        if (window.chrome && window.chrome.webview) {
            // WebView2 environment
            sendMessageToCSharp({
                action: 'executeGet',
                fullUrl: apiUrl
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
            const response = await fetch(apiUrl, {
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

    if (!tripDetailsData || !tripDetailsData.trip_id) {
        alert('Trip ID not found');
        return;
    }

    console.log('[Trip Details] Selected orders:', selectedOrders);

    // Prepare data for POST
    const ordersToAdd = selectedOrders.map(order => ({
        order_number: order.source_order_number,
        account_number: order.account_number,
        account_name: order.account_name,
        order_date: order.order_date,
        order_type: order.order_type_code,
        salesrep_name: order.salesrep_name,
        instance: order.instance
    }));

    const postData = {
        trip_id: parseInt(tripDetailsData.trip_id),
        orders: ordersToAdd
    };

    console.log('[Trip Details] POST data:', postData);

    // Disable add button
    const addBtn = document.getElementById('add-orders-to-trip-btn');
    const originalBtnText = addBtn.innerHTML;
    addBtn.disabled = true;
    addBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Adding...';

    try {
        const ADD_ORDERS_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/addorders';

        if (window.chrome && window.chrome.webview) {
            // WebView2 environment
            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: ADD_ORDERS_API,
                body: JSON.stringify(postData)
            }, function(error, data) {
                addBtn.disabled = false;
                addBtn.innerHTML = originalBtnText;

                if (error) {
                    console.error('[Trip Details] Error adding orders:', error);
                    alert('Error adding orders to trip:\n' + error);
                } else {
                    try {
                        const response = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log('[Trip Details] Orders added successfully:', response);

                        if (response.success) {
                            alert(`✅ Successfully added ${response.orders_added} order(s) to trip!`);

                            // Add to trip orders grid
                            tripOrdersData = [...tripOrdersData, ...selectedOrders];
                            if (tripOrdersGrid) {
                                tripOrdersGrid.option('dataSource', tripOrdersData);
                            }

                            updateOrdersCount();
                            closeAddOrdersModal();

                            // Reload pending orders to update "added_to_trip" status
                            loadPendingOrders();

                            // Refresh Trip Management grid if function exists
                            if (typeof window.refreshTripManagementAfterAddOrders === 'function') {
                                window.refreshTripManagementAfterAddOrders(tripDetailsData.trip_id);
                            }
                        } else {
                            alert('Error adding orders:\n' + (response.error || 'Unknown error'));
                        }
                    } catch (parseError) {
                        console.error('[Trip Details] Error parsing response:', parseError);
                        alert('Error processing response: ' + parseError.message);
                    }
                }
            });
        } else {
            // Fallback for browser testing
            const response = await fetch(ADD_ORDERS_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(postData)
            });

            const result = await response.json();

            addBtn.disabled = false;
            addBtn.innerHTML = originalBtnText;

            if (response.ok && result.success) {
                console.log('[Trip Details] Orders added successfully:', result);
                alert(`✅ Successfully added ${result.orders_added} order(s) to trip!`);

                // Add to trip orders grid
                tripOrdersData = [...tripOrdersData, ...selectedOrders];
                if (tripOrdersGrid) {
                    tripOrdersGrid.option('dataSource', tripOrdersData);
                }

                updateOrdersCount();
                closeAddOrdersModal();

                // Reload pending orders
                loadPendingOrders();

                // Refresh Trip Management grid if function exists
                if (typeof window.refreshTripManagementAfterAddOrders === 'function') {
                    window.refreshTripManagementAfterAddOrders(tripDetailsData.trip_id);
                }
            } else {
                console.error('[Trip Details] Error response:', result);
                alert('Error adding orders:\n' + (result.error || 'Unknown error'));
            }
        }
    } catch (error) {
        console.error('[Trip Details] Exception adding orders:', error);
        addBtn.disabled = false;
        addBtn.innerHTML = originalBtnText;
        alert('Error adding orders to trip:\n' + error.message);
    }
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
// EDIT TRIP DETAILS
// ============================================================================

window.editTripDetails = function() {
    console.log('[Trip Details] Opening edit trip modal...');

    const modal = document.getElementById('edit-trip-modal');
    if (!modal || !tripDetailsData) {
        alert('Unable to open edit modal');
        return;
    }

    // Populate vehicle dropdown
    const vehicleSelect = document.getElementById('edit-trip-vehicle');
    vehicleSelect.innerHTML = '<option value="">Select Vehicle</option>';
    if (window.vehiclesData && window.vehiclesData.length > 0) {
        window.vehiclesData.forEach(vehicle => {
            const option = document.createElement('option');
            option.value = vehicle.lorry_number;
            option.textContent = `${vehicle.lorry_number}${vehicle.assigned_route ? ' - ' + vehicle.assigned_route : ''}`;
            if (vehicle.lorry_number === tripDetailsData.trip_lorry || vehicle.lorry_number === tripDetailsData.vehicle) {
                option.selected = true;
            }
            vehicleSelect.appendChild(option);
        });
    }

    // Populate priority dropdown (1-20)
    const prioritySelect = document.getElementById('edit-trip-priority');
    prioritySelect.innerHTML = '<option value="">Select Priority</option>';
    for (let i = 1; i <= 20; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Priority ${i}`;
        if (i == (tripDetailsData.trip_priority || tripDetailsData.priority)) {
            option.selected = true;
        }
        prioritySelect.appendChild(option);
    }

    // Populate loading bay dropdown (L1-L30)
    const loadingBaySelect = document.getElementById('edit-trip-loading-bay');
    loadingBaySelect.innerHTML = '<option value="">Select Loading Bay</option>';
    for (let i = 1; i <= 30; i++) {
        const bay = `L${i}`;
        const option = document.createElement('option');
        option.value = bay;
        option.textContent = `Loading Bay ${bay}`;
        if (bay === (tripDetailsData.trip_loading_bay || tripDetailsData.loading_bay)) {
            option.selected = true;
        }
        loadingBaySelect.appendChild(option);
    }

    // Set current values
    document.getElementById('edit-trip-date').value = tripDetailsData.trip_date || '';
    document.getElementById('edit-trip-status').value = tripDetailsData.status || 'DRAFT';

    // Show modal
    modal.style.display = 'flex';
};

window.closeEditTripModal = function() {
    const modal = document.getElementById('edit-trip-modal');
    if (modal) {
        modal.style.display = 'none';
    }
};

window.updateTripDetails = async function() {
    console.log('[Trip Details] Updating trip...');

    if (!tripDetailsData || !tripDetailsData.trip_id) {
        alert('Trip ID not found');
        return;
    }

    // Get form values
    const tripDate = document.getElementById('edit-trip-date').value;
    const vehicle = document.getElementById('edit-trip-vehicle').value;
    const priority = document.getElementById('edit-trip-priority').value;
    const loadingBay = document.getElementById('edit-trip-loading-bay').value;
    const status = document.getElementById('edit-trip-status').value;

    // Validate
    if (!tripDate || !vehicle || !priority || !loadingBay) {
        alert('Please fill in all required fields');
        return;
    }

    // Prepare update data
    const updateData = {
        trip_id: tripDetailsData.trip_id,
        trip_date: tripDate,
        vehicle: vehicle,
        priority: parseInt(priority),
        loading_bay: loadingBay,
        status: status
    };

    console.log('[Trip Details] Update data:', updateData);

    // Disable update button
    const updateBtn = document.getElementById('update-trip-btn');
    const originalBtnText = updateBtn.innerHTML;
    updateBtn.disabled = true;
    updateBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...';

    try {
        // TODO: Call PUT API to update trip
        // const UPDATE_TRIP_API = 'https://...your-api-endpoint.../trips/update';

        // For now, just update local data
        tripDetailsData.trip_date = tripDate;
        tripDetailsData.trip_lorry = vehicle;
        tripDetailsData.vehicle = vehicle;
        tripDetailsData.trip_priority = priority;
        tripDetailsData.trip_loading_bay = loadingBay;
        tripDetailsData.status = status;

        // Update header display
        populateTripHeader(tripDetailsData);

        updateBtn.disabled = false;
        updateBtn.innerHTML = originalBtnText;

        alert('Trip updated successfully!\n\n(PUT API integration pending)');
        closeEditTripModal();

    } catch (error) {
        console.error('[Trip Details] Error updating trip:', error);
        updateBtn.disabled = false;
        updateBtn.innerHTML = originalBtnText;
        alert('Error updating trip: ' + error.message);
    }
};

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

// ============================================================================
// PASTE ORDERS FUNCTIONALITY
// ============================================================================

// Store found orders globally for selection
let foundOrdersFromPaste = [];

window.openPasteOrdersPopup = function() {
    console.log('[Paste Orders] Opening paste orders popup');

    // Reset textarea and results
    document.getElementById('paste-orders-textarea').value = '';
    document.getElementById('paste-orders-results').style.display = 'none';
    document.getElementById('add-pasted-orders-btn').style.display = 'none';
    foundOrdersFromPaste = [];

    // Show popup
    const popup = document.getElementById('paste-orders-popup');
    if (popup) {
        popup.style.display = 'flex';
    }
};

window.closePasteOrdersPopup = function() {
    console.log('[Paste Orders] Closing paste orders popup');
    const popup = document.getElementById('paste-orders-popup');
    if (popup) {
        popup.style.display = 'none';
    }
};

window.searchPastedOrders = function() {
    console.log('[Paste Orders] Searching for pasted orders');

    const textarea = document.getElementById('paste-orders-textarea');
    const text = textarea.value.trim();

    if (!text) {
        alert('Please paste order numbers first');
        return;
    }

    // Split by newlines and clean up
    const orderNumbers = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    if (orderNumbers.length === 0) {
        alert('No valid order numbers found');
        return;
    }

    console.log('[Paste Orders] Searching for', orderNumbers.length, 'orders');

    // Get data directly from the grid
    if (!pendingOrdersGrid) {
        alert('Orders grid not initialized. Please open the Add Orders dialog first.');
        return;
    }

    // Get the current data source from the grid
    const gridData = pendingOrdersGrid.option('dataSource');

    if (!gridData || gridData.length === 0) {
        alert('No pending orders loaded in grid. Please refresh the orders list first.');
        return;
    }

    console.log('[Paste Orders] Grid has', gridData.length, 'orders');

    // Debug: Log first order to see field structure
    if (gridData.length > 0) {
        console.log('[Paste Orders] ===== GRID DATA STRUCTURE =====');
        console.log('[Paste Orders] Sample order from grid:', gridData[0]);
        console.log('[Paste Orders] Available fields:', Object.keys(gridData[0]));

        // Show first 5 order numbers in grid
        console.log('[Paste Orders] First 5 order numbers in grid:');
        gridData.slice(0, 5).forEach((order, idx) => {
            const on = order.source_order_number || order.SOURCE_ORDER_NUMBER || order.ORDER_NUMBER || order.order_number || order.orderNumber;
            console.log(`  [${idx}] Order Number: "${on}" (type: ${typeof on})`);
        });
        console.log('[Paste Orders] ===============================');
    }

    // Search for each order in grid data
    const results = [];
    foundOrdersFromPaste = [];

    orderNumbers.forEach(orderNum => {
        const searchValue = orderNum.trim();

        console.log('[Paste Orders] ===== Searching for:', searchValue);

        // Find order in grid data - try different field name variations
        const foundOrder = gridData.find(order => {
            // Try all possible field names
            const on1 = order.source_order_number ? order.source_order_number.toString().trim() : null;
            const on2 = order.SOURCE_ORDER_NUMBER ? order.SOURCE_ORDER_NUMBER.toString().trim() : null;
            const on3 = order.ORDER_NUMBER ? order.ORDER_NUMBER.toString().trim() : null;
            const on4 = order.order_number ? order.order_number.toString().trim() : null;
            const on5 = order.orderNumber ? order.orderNumber.toString().trim() : null;

            // Case-insensitive comparison
            const match1 = on1 && on1.toUpperCase() === searchValue.toUpperCase();
            const match2 = on2 && on2.toUpperCase() === searchValue.toUpperCase();
            const match3 = on3 && on3.toUpperCase() === searchValue.toUpperCase();
            const match4 = on4 && on4.toUpperCase() === searchValue.toUpperCase();
            const match5 = on5 && on5.toUpperCase() === searchValue.toUpperCase();

            return match1 || match2 || match3 || match4 || match5;
        });

        if (foundOrder) {
            const on = foundOrder.source_order_number || foundOrder.SOURCE_ORDER_NUMBER || foundOrder.ORDER_NUMBER || foundOrder.order_number || foundOrder.orderNumber;
            console.log(`[Paste Orders] ✅ Found "${searchValue}" -> Order #${on}`);
            results.push({
                orderNumber: orderNum,
                found: true,
                order: foundOrder
            });
            foundOrdersFromPaste.push(foundOrder);
        } else {
            console.log(`[Paste Orders] ❌ NOT FOUND: "${searchValue}"`);

            // Debug: Show if this order exists anywhere in the grid (partial match search)
            const exists = gridData.some(order => {
                const on1 = order.source_order_number ? order.source_order_number.toString() : '';
                const on2 = order.SOURCE_ORDER_NUMBER ? order.SOURCE_ORDER_NUMBER.toString() : '';
                const on3 = order.ORDER_NUMBER ? order.ORDER_NUMBER.toString() : '';
                const on4 = order.order_number ? order.order_number.toString() : '';
                const on5 = order.orderNumber ? order.orderNumber.toString() : '';
                return on1.includes(searchValue) || on2.includes(searchValue) || on3.includes(searchValue) || on4.includes(searchValue) || on5.includes(searchValue);
            });

            if (exists) {
                console.log(`[Paste Orders]   ⚠️  But order containing "${searchValue}" EXISTS in grid (check for exact match issue)`);
            }

            results.push({
                orderNumber: orderNum,
                found: false,
                order: null
            });
        }
    });

    console.log('[Paste Orders] ===== SEARCH COMPLETE =====');
    console.log('[Paste Orders] Found:', foundOrdersFromPaste.length, 'Not found:', (results.length - foundOrdersFromPaste.length));

    // Display results
    displayPasteOrdersResults(results);
};

function displayPasteOrdersResults(results) {
    const foundCount = results.filter(r => r.found).length;
    const notFoundCount = results.filter(r => !r.found).length;

    console.log('[Paste Orders] Results:', foundCount, 'found,', notFoundCount, 'not found');

    // Update counts
    document.getElementById('found-count').textContent = foundCount;
    document.getElementById('not-found-count').textContent = notFoundCount;

    // Build results list HTML
    let html = '';
    results.forEach(result => {
        if (result.found) {
            html += `
                <div style="display: flex; align-items: center; padding: 0.5rem; margin-bottom: 0.25rem; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px;">
                    <i class="fas fa-check-circle" style="color: #28a745; margin-right: 0.5rem;"></i>
                    <span style="font-family: monospace; font-weight: 600; color: #155724;">${result.orderNumber}</span>
                    <span style="margin-left: auto; font-size: 12px; color: #155724;">
                        ${result.order.account_name || result.order.ACCOUNT_NAME || ''}
                    </span>
                </div>
            `;
        } else {
            html += `
                <div style="display: flex; align-items: center; padding: 0.5rem; margin-bottom: 0.25rem; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px;">
                    <i class="fas fa-times-circle" style="color: #dc3545; margin-right: 0.5rem;"></i>
                    <span style="font-family: monospace; font-weight: 600; color: #721c24;">${result.orderNumber}</span>
                    <span style="margin-left: auto; font-size: 12px; color: #721c24; font-style: italic;">Not found in pending orders</span>
                </div>
            `;
        }
    });

    // Display results
    document.getElementById('paste-orders-results-list').innerHTML = html;
    document.getElementById('paste-orders-results').style.display = 'block';

    // Show/hide Add to Trip button
    if (foundCount > 0) {
        document.getElementById('add-pasted-orders-btn').style.display = 'inline-block';
    } else {
        document.getElementById('add-pasted-orders-btn').style.display = 'none';
    }
}

window.addPastedOrdersToTrip = async function() {
    console.log('[Paste Orders] Adding', foundOrdersFromPaste.length, 'pasted orders to trip...');

    if (foundOrdersFromPaste.length === 0) {
        alert('No orders to add');
        return;
    }

    if (!tripDetailsData || !tripDetailsData.trip_id) {
        alert('Trip ID not found');
        return;
    }

    console.log('[Paste Orders] Found orders:', foundOrdersFromPaste);

    // Prepare data for POST - same format as main Add to Trip
    const ordersToAdd = foundOrdersFromPaste.map(order => ({
        order_number: order.source_order_number,
        account_number: order.account_number,
        account_name: order.account_name,
        order_date: order.order_date,
        order_type: order.order_type_code,
        salesrep_name: order.salesrep_name,
        instance: order.instance
    }));

    const postData = {
        trip_id: parseInt(tripDetailsData.trip_id),
        orders: ordersToAdd
    };

    console.log('[Paste Orders] POST data:', postData);

    // Disable add button
    const addBtn = document.getElementById('add-pasted-orders-btn');
    const originalBtnText = addBtn.innerHTML;
    addBtn.disabled = true;
    addBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Adding...';

    try {
        const ADD_ORDERS_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/addorders';

        if (window.chrome && window.chrome.webview) {
            // WebView2 environment
            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: ADD_ORDERS_API,
                body: JSON.stringify(postData)
            }, function(error, data) {
                addBtn.disabled = false;
                addBtn.innerHTML = originalBtnText;

                if (error) {
                    console.error('[Paste Orders] Error adding orders:', error);
                    alert('Error adding orders to trip:\n' + error);
                } else {
                    try {
                        const response = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log('[Paste Orders] Orders added successfully:', response);

                        if (response.success) {
                            alert(`✅ Successfully added ${response.orders_added} order(s) to trip!`);

                            // Add to trip orders grid
                            tripOrdersData = [...tripOrdersData, ...foundOrdersFromPaste];
                            if (tripOrdersGrid) {
                                tripOrdersGrid.option('dataSource', tripOrdersData);
                            }

                            updateOrdersCount();
                            closePasteOrdersPopup();
                            // Keep Add Orders modal open so user can continue adding more orders

                            // Reload pending orders to update "added_to_trip" status
                            loadPendingOrders();

                            // Refresh Trip Management grid if function exists
                            if (typeof window.refreshTripManagementAfterAddOrders === 'function') {
                                window.refreshTripManagementAfterAddOrders(tripDetailsData.trip_id);
                            }
                        } else {
                            alert('Error adding orders:\n' + (response.error || 'Unknown error'));
                        }
                    } catch (parseError) {
                        console.error('[Paste Orders] Error parsing response:', parseError);
                        alert('Error processing server response');
                    }
                }
            });
        } else {
            // Fallback for browser testing
            const response = await fetch(ADD_ORDERS_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(postData)
            });

            addBtn.disabled = false;
            addBtn.innerHTML = originalBtnText;

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('[Paste Orders] Orders added successfully:', result);

            if (result.success) {
                alert(`✅ Successfully added ${result.orders_added} order(s) to trip!`);

                // Add to trip orders grid
                tripOrdersData = [...tripOrdersData, ...foundOrdersFromPaste];
                if (tripOrdersGrid) {
                    tripOrdersGrid.option('dataSource', tripOrdersData);
                }

                updateOrdersCount();
                closePasteOrdersPopup();
                // Keep Add Orders modal open so user can continue adding more orders

                // Reload pending orders
                loadPendingOrders();

                // Refresh Trip Management grid
                if (typeof window.refreshTripManagementAfterAddOrders === 'function') {
                    window.refreshTripManagementAfterAddOrders(tripDetailsData.trip_id);
                }
            } else {
                alert('Error adding orders:\n' + (result.error || 'Unknown error'));
            }
        }
    } catch (error) {
        console.error('[Paste Orders] Error adding orders:', error);
        addBtn.disabled = false;
        addBtn.innerHTML = originalBtnText;
        alert('Error adding orders to trip:\n' + error.message);
    }
};

console.log('[Trip Details] ✅ Module loaded');

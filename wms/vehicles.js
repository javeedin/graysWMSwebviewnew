// ============================================================================
// VEHICLES MANAGEMENT
// ============================================================================

console.log('[Vehicles] Loading...');

// Global variables
let vehiclesGrid = null;
let vehiclesData = [];

// API Endpoint
const VEHICLES_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/vehicles/get';

// Load vehicles when page is shown
document.addEventListener('DOMContentLoaded', function() {
    console.log('[Vehicles] DOM ready');

    // Listen for page changes
    const vehiclesPage = document.getElementById('vehicles-management');
    if (vehiclesPage) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.attributeName === 'style') {
                    const isVisible = vehiclesPage.style.display !== 'none';
                    if (isVisible && !vehiclesGrid) {
                        console.log('[Vehicles] Page shown, initializing grid');
                        initializeVehiclesGrid();
                        loadVehicles();
                    }
                }
            });
        });

        observer.observe(vehiclesPage, { attributes: true });
    }
});

// Initialize DevExpress DataGrid
function initializeVehiclesGrid() {
    console.log('[Vehicles] Initializing grid...');

    try {
        vehiclesGrid = $('#vehicles-grid').dxDataGrid({
            dataSource: [],
            showBorders: true,
            showRowLines: true,
            showColumnLines: true,
            rowAlternationEnabled: true,
            columnAutoWidth: true,
            allowColumnReordering: true,
            allowColumnResizing: true,
            wordWrapEnabled: true,
            hoverStateEnabled: true,
            filterRow: {
                visible: true,
                applyFilter: 'auto'
            },
            headerFilter: {
                visible: true
            },
            searchPanel: {
                visible: true,
                width: 240,
                placeholder: 'Search...'
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
                    dataField: 'lorry_number',
                    caption: 'Lorry Number',
                    width: 150,
                    fixed: true
                },
                {
                    dataField: 'assigned_route',
                    caption: 'Assigned Route',
                    width: 150
                },
                {
                    dataField: 'delivery_officer',
                    caption: 'Delivery Officer',
                    width: 150
                },
                {
                    dataField: 'capacity',
                    caption: 'Capacity',
                    width: 120,
                    dataType: 'number'
                },
                {
                    dataField: 'status',
                    caption: 'Status',
                    width: 120,
                    cellTemplate: function(container, options) {
                        const status = options.value || 'Unknown';
                        const statusClass = status.toLowerCase();
                        container.append(
                            $('<span>')
                                .addClass(`status-badge status-${statusClass}`)
                                .text(status)
                        );
                    }
                },
                {
                    dataField: 'date_created',
                    caption: 'Date Created',
                    width: 150,
                    dataType: 'datetime',
                    format: 'yyyy-MM-dd HH:mm'
                },
                {
                    caption: 'Actions',
                    width: 120,
                    cellTemplate: function(container, options) {
                        const editBtn = $('<button>')
                            .addClass('grid-action-btn btn-preview')
                            .html('<i class="fas fa-edit"></i>')
                            .attr('title', 'Edit Vehicle')
                            .on('click', function() {
                                editVehicle(options.data);
                            });

                        const deleteBtn = $('<button>')
                            .addClass('grid-action-btn btn-retry')
                            .html('<i class="fas fa-trash"></i>')
                            .attr('title', 'Delete Vehicle')
                            .css('background', '#dc3545')
                            .on('click', function() {
                                deleteVehicle(options.data.lorry_number);
                            });

                        container.append(editBtn).append(' ').append(deleteBtn);
                    },
                    allowFiltering: false,
                    allowSorting: false
                }
            ],
            onContentReady: function(e) {
                console.log('[Vehicles] Grid content ready, row count:', e.component.totalCount());
            }
        }).dxDataGrid('instance');

        console.log('[Vehicles] Grid initialized successfully');
    } catch (error) {
        console.error('[Vehicles] Error initializing grid:', error);
    }
}

// Load vehicles from API using WebView2 REST call
window.loadVehicles = async function() {
    console.log('[Vehicles] Loading vehicles from API...');

    try {
        // Use WebView2's REST API call feature to bypass CORS
        if (window.chrome && window.chrome.webview) {
            // WebView2 environment - use postMessage to C# backend
            window.chrome.webview.postMessage({
                type: 'REST_API_CALL',
                url: VEHICLES_API,
                method: 'GET',
                callback: 'handleVehiclesData'
            });
        } else {
            // Fallback to direct fetch for testing in browser
            const response = await fetch(VEHICLES_API, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            handleVehiclesData(data);
        }

    } catch (error) {
        console.error('[Vehicles] Error loading vehicles:', error);
        alert('Error loading vehicles: ' + error.message);
    }
};

// Callback function to handle vehicles data from C# or direct fetch
window.handleVehiclesData = function(data) {
    try {
        vehiclesData = data.items || [];

        console.log('[Vehicles] Loaded', vehiclesData.length, 'vehicles');

        // Update grid
        if (vehiclesGrid) {
            vehiclesGrid.option('dataSource', vehiclesData);
        }

        // Update count
        const countDisplay = document.getElementById('vehicles-count-display');
        if (countDisplay) {
            countDisplay.textContent = `${vehiclesData.length} vehicle${vehiclesData.length !== 1 ? 's' : ''}`;
        }
    } catch (error) {
        console.error('[Vehicles] Error processing vehicles data:', error);
        alert('Error processing vehicles data: ' + error.message);
    }
};

// Show Add Vehicle Modal
window.showAddVehicleModal = function() {
    console.log('[Vehicles] Opening add vehicle modal');

    document.getElementById('vehicle-modal-title').textContent = 'Add New Vehicle';
    document.getElementById('edit-vehicle-id').value = '';
    document.getElementById('modal-lorry-number').value = '';
    document.getElementById('modal-assigned-route').value = '';
    document.getElementById('modal-delivery-officer').value = '';
    document.getElementById('modal-capacity').value = '';
    document.getElementById('modal-vehicle-status').value = '';

    document.getElementById('vehicle-modal').style.display = 'flex';
};

// Edit Vehicle
function editVehicle(vehicle) {
    console.log('[Vehicles] Editing vehicle:', vehicle);

    document.getElementById('vehicle-modal-title').textContent = 'Edit Vehicle';
    document.getElementById('edit-vehicle-id').value = vehicle.lorry_number;
    document.getElementById('modal-lorry-number').value = vehicle.lorry_number || '';
    document.getElementById('modal-assigned-route').value = vehicle.assigned_route || '';
    document.getElementById('modal-delivery-officer').value = vehicle.delivery_officer || '';
    document.getElementById('modal-capacity').value = vehicle.capacity || '';
    document.getElementById('modal-vehicle-status').value = vehicle.status || '';

    document.getElementById('modal-lorry-number').disabled = true; // Don't allow changing lorry number

    document.getElementById('vehicle-modal').style.display = 'flex';
}

// Close Vehicle Modal
window.closeVehicleModal = function() {
    document.getElementById('vehicle-modal').style.display = 'none';
    document.getElementById('modal-lorry-number').disabled = false;
};

// Save Vehicle
window.saveVehicle = async function() {
    const lorryNumber = document.getElementById('modal-lorry-number').value.trim();
    const assignedRoute = document.getElementById('modal-assigned-route').value.trim();
    const deliveryOfficer = document.getElementById('modal-delivery-officer').value.trim();
    const capacity = document.getElementById('modal-capacity').value.trim();
    const status = document.getElementById('modal-vehicle-status').value.trim();
    const editId = document.getElementById('edit-vehicle-id').value;

    if (!lorryNumber) {
        alert('Please enter lorry number');
        return;
    }

    const vehicleData = {
        lorry_number: lorryNumber,
        assigned_route: assignedRoute,
        delivery_officer: deliveryOfficer,
        capacity: capacity ? parseInt(capacity) : null,
        status: status
    };

    console.log('[Vehicles] Saving vehicle:', vehicleData);

    try {
        // For now, just show a message since we don't have POST/PUT endpoints
        // In production, you would call the API here
        if (editId) {
            alert('Vehicle updated successfully!\n\n(Note: API integration pending)');
        } else {
            alert('Vehicle added successfully!\n\n(Note: API integration pending)');
        }

        closeVehicleModal();
        loadVehicles();

    } catch (error) {
        console.error('[Vehicles] Error saving vehicle:', error);
        alert('Error saving vehicle: ' + error.message);
    }
};

// Delete Vehicle
function deleteVehicle(lorryNumber) {
    if (!confirm(`Are you sure you want to delete vehicle ${lorryNumber}?`)) {
        return;
    }

    console.log('[Vehicles] Deleting vehicle:', lorryNumber);

    // For now, just show a message since we don't have DELETE endpoint
    // In production, you would call the API here
    alert('Vehicle deleted successfully!\n\n(Note: API integration pending)');
    loadVehicles();
}

console.log('[Vehicles] ✅ Module loaded');

// ============================================================================
// VEHICLES MANAGEMENT
// ============================================================================

console.log('[Vehicles] Loading...');

// Global variables
let vehiclesGrid = null;
window.vehiclesData = []; // Expose to window for cross-module access

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

// Helper function to convert snake_case or lowercase to Title Case
function formatColumnCaption(fieldName) {
    return fieldName
        .replace(/_/g, ' ')           // Replace underscores with spaces
        .replace(/([a-z])([A-Z])/g, '$1 $2')  // Handle camelCase
        .replace(/\b\w/g, char => char.toUpperCase());  // Capitalize first letter of each word
}

// Helper function to detect column data type based on sample values
function detectColumnType(values) {
    // Filter out null/undefined values
    const validValues = values.filter(v => v !== null && v !== undefined);
    if (validValues.length === 0) return 'string';

    // Check if all values are numbers
    const allNumbers = validValues.every(v => typeof v === 'number' || (!isNaN(parseFloat(v)) && isFinite(v)));
    if (allNumbers) return 'number';

    // Check if values look like dates
    const datePattern = /^\d{4}-\d{2}-\d{2}|^\d{2}\/\d{2}\/\d{4}/;
    const allDates = validValues.every(v => typeof v === 'string' && datePattern.test(v));
    if (allDates) return 'date';

    return 'string';
}

// Generate dynamic columns based on data
function generateDynamicColumns(data) {
    if (!data || data.length === 0) {
        console.log('[Vehicles] No data to generate columns from');
        return [];
    }

    // Get all unique field names from all records
    const fieldSet = new Set();
    data.forEach(item => {
        Object.keys(item).forEach(key => fieldSet.add(key));
    });

    const fields = Array.from(fieldSet);
    console.log('[Vehicles] Generating columns for fields:', fields);

    // Sample values for type detection (take up to 10 samples per field)
    const columns = fields.map((field, index) => {
        const sampleValues = data.slice(0, 10).map(item => item[field]);
        const dataType = detectColumnType(sampleValues);

        const column = {
            dataField: field,
            caption: formatColumnCaption(field),
            allowFiltering: true,
            allowSorting: true
        };

        // Make first column fixed for better UX
        if (index === 0) {
            column.fixed = true;
            column.width = 150;
        }

        // Set data type and format based on detected type
        if (dataType === 'number') {
            column.dataType = 'number';
            // Check if values have decimals
            const hasDecimals = sampleValues.some(v => v !== null && v !== undefined && v.toString().includes('.'));
            if (hasDecimals) {
                column.format = { type: 'fixedPoint', precision: 2 };
            }
        } else if (dataType === 'date') {
            column.dataType = 'date';
            column.format = 'yyyy-MM-dd';
        }

        // Special handling for status fields
        if (field.toLowerCase() === 'status') {
            column.cellTemplate = function(container, options) {
                const status = options.value || 'Unknown';
                const statusClass = status.toString().toLowerCase().replace(/\s+/g, '-');
                container.append(
                    $('<span>')
                        .addClass(`status-badge status-${statusClass}`)
                        .text(status)
                );
            };
        }

        return column;
    });

    return columns;
}

// Initialize DevExpress DataGrid (dynamic - columns will be set when data loads)
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
            // No hardcoded columns - they will be generated dynamically from data
            columns: [],
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
            // WebView2 environment - use sendMessageToCSharp helper
            sendMessageToCSharp({
                action: 'executeGet',
                fullUrl: VEHICLES_API
            }, function(error, data) {
                if (error) {
                    console.error('[Vehicles] Error loading vehicles:', error);
                    alert('Error loading vehicles: ' + error);
                } else {
                    try {
                        const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
                        handleVehiclesData(jsonData);
                    } catch (parseError) {
                        console.error('[Vehicles] Error parsing response:', parseError);
                        alert('Error parsing vehicles data: ' + parseError.message);
                    }
                }
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
        window.vehiclesData = data.items || [];

        console.log('[Vehicles] Loaded', window.vehiclesData.length, 'vehicles');

        // Update grid with dynamic columns
        if (vehiclesGrid) {
            // Generate columns dynamically based on the data
            const dynamicColumns = generateDynamicColumns(window.vehiclesData);
            console.log('[Vehicles] Generated', dynamicColumns.length, 'dynamic columns');

            // Update grid columns and data source
            vehiclesGrid.option('columns', dynamicColumns);
            vehiclesGrid.option('dataSource', window.vehiclesData);
        }

        // Update count
        const countDisplay = document.getElementById('vehicles-count-display');
        if (countDisplay) {
            countDisplay.textContent = `${window.vehiclesData.length} vehicle${window.vehiclesData.length !== 1 ? 's' : ''}`;
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

// ============================================================================
// API INFO FUNCTIONS
// ============================================================================

// Show Vehicles API Modal
window.showVehiclesApi = function() {
    console.log('[Vehicles] Showing API info');

    try {
        // Get modal elements
        const modal = document.getElementById('vehicles-api-modal');
        const urlElement = document.getElementById('vehicles-api-url');
        const resultElement = document.getElementById('vehicles-api-result');

        if (!modal) {
            console.error('[Vehicles] API modal element not found!');
            alert('Error: API modal not found. Please check if vehicles-api-modal element exists.');
            return;
        }

        // Set the API URL in the modal
        if (urlElement) {
            urlElement.textContent = VEHICLES_API;
        }

        // Hide previous results
        if (resultElement) {
            resultElement.style.display = 'none';
        }

        // Show the modal
        modal.style.display = 'flex';
        console.log('[Vehicles] API modal displayed');
    } catch (error) {
        console.error('[Vehicles] Error showing API modal:', error);
        alert('Error showing API modal: ' + error.message);
    }
};

// Close Vehicles API Modal
window.closeVehiclesApiModal = function() {
    document.getElementById('vehicles-api-modal').style.display = 'none';
};

// Copy Vehicles API URL to clipboard
window.copyVehiclesApiUrl = function() {
    navigator.clipboard.writeText(VEHICLES_API).then(function() {
        // Show success feedback
        DevExpress.ui.notify({
            message: 'API URL copied to clipboard!',
            type: 'success',
            displayTime: 2000,
            position: { my: 'top center', at: 'top center', offset: '0 10' }
        });
    }).catch(function(err) {
        console.error('[Vehicles] Failed to copy URL:', err);
        alert('Failed to copy URL. Please copy manually.');
    });
};

// Test Vehicles API
window.testVehiclesApi = function() {
    console.log('[Vehicles] Testing API...');

    const resultDiv = document.getElementById('vehicles-api-result');
    const responseDiv = document.getElementById('vehicles-api-response');

    // Show loading state
    resultDiv.style.display = 'block';
    responseDiv.textContent = 'Loading...';
    resultDiv.querySelector('div').style.background = '#f3f4f6';
    resultDiv.querySelector('div').style.borderColor = '#e5e7eb';

    // Use WebView2 or fetch to test the API
    if (window.chrome && window.chrome.webview) {
        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: VEHICLES_API
        }, function(error, data) {
            if (error) {
                resultDiv.querySelector('div').style.background = '#fef2f2';
                resultDiv.querySelector('div').style.borderColor = '#fecaca';
                resultDiv.querySelector('label i').className = 'fas fa-times-circle';
                resultDiv.querySelector('label i').style.color = '#ef4444';
                resultDiv.querySelector('label').innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444; margin-right: 0.5rem;"></i>API Error';
                responseDiv.textContent = 'Error: ' + error;
            } else {
                try {
                    const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
                    resultDiv.querySelector('div').style.background = '#f0fdf4';
                    resultDiv.querySelector('div').style.borderColor = '#bbf7d0';
                    resultDiv.querySelector('label').innerHTML = '<i class="fas fa-check-circle" style="color: #10b981; margin-right: 0.5rem;"></i>API Response (' + (jsonData.items ? jsonData.items.length : 0) + ' records)';
                    responseDiv.textContent = JSON.stringify(jsonData, null, 2);
                } catch (parseError) {
                    responseDiv.textContent = 'Raw response:\n' + data;
                }
            }
        });
    } else {
        // Fallback to fetch
        fetch(VEHICLES_API, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            resultDiv.querySelector('div').style.background = '#f0fdf4';
            resultDiv.querySelector('div').style.borderColor = '#bbf7d0';
            resultDiv.querySelector('label').innerHTML = '<i class="fas fa-check-circle" style="color: #10b981; margin-right: 0.5rem;"></i>API Response (' + (data.items ? data.items.length : 0) + ' records)';
            responseDiv.textContent = JSON.stringify(data, null, 2);
        })
        .catch(error => {
            resultDiv.querySelector('div').style.background = '#fef2f2';
            resultDiv.querySelector('div').style.borderColor = '#fecaca';
            resultDiv.querySelector('label').innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444; margin-right: 0.5rem;"></i>API Error';
            responseDiv.textContent = 'Error: ' + error.message + '\n\n(Note: CORS may block direct browser access. Use the app for full functionality.)';
        });
    }
};

console.log('[Vehicles] ✅ Module loaded');

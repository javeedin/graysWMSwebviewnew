// ============================================================================
// PICKERS MANAGEMENT
// ============================================================================

console.log('[Pickers] Loading...');

// Global variables
let pickersGrid = null;
window.pickersData = []; // Expose to window for cross-module access

// API Endpoint
const PICKERS_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/pickers/getpickers';

// Load pickers when page is shown
document.addEventListener('DOMContentLoaded', function() {
    console.log('[Pickers] DOM ready');

    // Listen for page changes
    const pickersPage = document.getElementById('pickers-management');
    if (pickersPage) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.attributeName === 'style') {
                    const isVisible = pickersPage.style.display !== 'none';
                    if (isVisible && !pickersGrid) {
                        console.log('[Pickers] Page shown, initializing grid');
                        initializePickersGrid();
                        loadPickers();
                    }
                }
            });
        });

        observer.observe(pickersPage, { attributes: true });
    }
});

// Initialize DevExpress DataGrid
function initializePickersGrid() {
    console.log('[Pickers] Initializing grid...');

    try {
        pickersGrid = $('#pickers-grid').dxDataGrid({
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
                    dataField: 'picker_id',
                    caption: 'ID',
                    width: 80,
                    dataType: 'number'
                },
                {
                    dataField: 'name',
                    caption: 'Name',
                    width: 150,
                    fixed: true
                },
                {
                    dataField: 'picker_type',
                    caption: 'Type',
                    width: 120,
                    cellTemplate: function(container, options) {
                        const type = options.value || 'Unknown';
                        const typeClass = type.toLowerCase();
                        container.append(
                            $('<span>')
                                .addClass(`status-badge`)
                                .css({
                                    'background': type === 'Bulk' ? '#dbeafe' : type === 'Individual' ? '#fef3c7' : '#d1fae5',
                                    'color': type === 'Bulk' ? '#1e40af' : type === 'Individual' ? '#92400e' : '#065f46'
                                })
                                .text(type)
                        );
                    }
                },
                {
                    dataField: 'contact',
                    caption: 'Contact',
                    width: 150
                },
                {
                    dataField: 'assigned_area',
                    caption: 'Assigned Area',
                    width: 150
                },
                {
                    dataField: 'profit_center',
                    caption: 'Profit Center',
                    width: 120
                },
                {
                    dataField: 'category',
                    caption: 'Category',
                    width: 100
                },
                {
                    dataField: 'deleted',
                    caption: 'Status',
                    width: 100,
                    cellTemplate: function(container, options) {
                        const isDeleted = options.value === 1;
                        const statusText = isDeleted ? 'Deleted' : 'Active';
                        const statusClass = isDeleted ? 'status-cancelled' : 'status-completed';
                        container.append(
                            $('<span>')
                                .addClass(`status-badge ${statusClass}`)
                                .text(statusText)
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
                            .attr('title', 'Edit Picker')
                            .on('click', function() {
                                editPicker(options.data);
                            });

                        const deleteBtn = $('<button>')
                            .addClass('grid-action-btn btn-retry')
                            .html('<i class="fas fa-trash"></i>')
                            .attr('title', 'Delete Picker')
                            .css('background', '#dc3545')
                            .on('click', function() {
                                deletePicker(options.data.picker_id, options.data.name);
                            });

                        container.append(editBtn).append(' ').append(deleteBtn);
                    },
                    allowFiltering: false,
                    allowSorting: false
                }
            ],
            onContentReady: function(e) {
                console.log('[Pickers] Grid content ready, row count:', e.component.totalCount());
            }
        }).dxDataGrid('instance');

        console.log('[Pickers] Grid initialized successfully');
    } catch (error) {
        console.error('[Pickers] Error initializing grid:', error);
    }
}

// Load pickers from API using WebView2 REST call
window.loadPickers = async function() {
    console.log('[Pickers] Loading pickers from API...');

    try {
        // Use WebView2's REST API call feature to bypass CORS
        if (window.chrome && window.chrome.webview) {
            // WebView2 environment - use sendMessageToCSharp helper
            sendMessageToCSharp({
                action: 'executeGet',
                fullUrl: PICKERS_API
            }, function(error, data) {
                if (error) {
                    console.error('[Pickers] Error loading pickers:', error);
                    alert('Error loading pickers: ' + error);
                } else {
                    try {
                        const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
                        handlePickersData(jsonData);
                    } catch (parseError) {
                        console.error('[Pickers] Error parsing response:', parseError);
                        alert('Error parsing pickers data: ' + parseError.message);
                    }
                }
            });
        } else {
            // Fallback to direct fetch for testing in browser
            const response = await fetch(PICKERS_API, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            handlePickersData(data);
        }

    } catch (error) {
        console.error('[Pickers] Error loading pickers:', error);
        alert('Error loading pickers: ' + error.message);
    }
};

// Callback function to handle pickers data from C# or direct fetch
window.handlePickersData = function(data) {
    try {
        window.pickersData = data.items || [];

        console.log('[Pickers] Loaded', window.pickersData.length, 'pickers');

        // Update grid
        if (pickersGrid) {
            pickersGrid.option('dataSource', window.pickersData);
        }

        // Update count
        const countDisplay = document.getElementById('pickers-count-display');
        if (countDisplay) {
            countDisplay.textContent = `${window.pickersData.length} picker${window.pickersData.length !== 1 ? 's' : ''}`;
        }
    } catch (error) {
        console.error('[Pickers] Error processing pickers data:', error);
        alert('Error processing pickers data: ' + error.message);
    }
};

// Show Add Picker Modal
window.showAddPickerModal = function() {
    console.log('[Pickers] Opening add picker modal');

    document.getElementById('picker-modal-title').textContent = 'Add New Picker';
    document.getElementById('edit-picker-id').value = '';
    document.getElementById('modal-picker-name').value = '';
    document.getElementById('modal-picker-type').value = '';
    document.getElementById('modal-picker-contact').value = '';
    document.getElementById('modal-picker-assigned-area').value = '';
    document.getElementById('modal-picker-profit-center').value = '';
    document.getElementById('modal-picker-category').value = '';

    document.getElementById('picker-modal').style.display = 'flex';
};

// Edit Picker
function editPicker(picker) {
    console.log('[Pickers] Editing picker:', picker);

    document.getElementById('picker-modal-title').textContent = 'Edit Picker';
    document.getElementById('edit-picker-id').value = picker.picker_id;
    document.getElementById('modal-picker-name').value = picker.name || '';
    document.getElementById('modal-picker-type').value = picker.picker_type || '';
    document.getElementById('modal-picker-contact').value = picker.contact || '';
    document.getElementById('modal-picker-assigned-area').value = picker.assigned_area || '';
    document.getElementById('modal-picker-profit-center').value = picker.profit_center || '';
    document.getElementById('modal-picker-category').value = picker.category || '';

    document.getElementById('picker-modal').style.display = 'flex';
}

// Close Picker Modal
window.closePickerModal = function() {
    document.getElementById('picker-modal').style.display = 'none';
};

// Save Picker
window.savePicker = async function() {
    const name = document.getElementById('modal-picker-name').value.trim();
    const pickerType = document.getElementById('modal-picker-type').value.trim();
    const contact = document.getElementById('modal-picker-contact').value.trim();
    const assignedArea = document.getElementById('modal-picker-assigned-area').value.trim();
    const profitCenter = document.getElementById('modal-picker-profit-center').value.trim();
    const category = document.getElementById('modal-picker-category').value.trim();
    const editId = document.getElementById('edit-picker-id').value;

    if (!name) {
        alert('Please enter picker name');
        return;
    }

    if (!pickerType) {
        alert('Please select picker type');
        return;
    }

    const pickerData = {
        name: name,
        picker_type: pickerType,
        contact: contact,
        assigned_area: assignedArea,
        profit_center: profitCenter,
        category: category,
        deleted: 0
    };

    console.log('[Pickers] Saving picker:', pickerData);

    try {
        // For now, just show a message since we don't have POST/PUT endpoints
        // In production, you would call the API here
        if (editId) {
            alert('Picker updated successfully!\n\n(Note: API integration pending)');
        } else {
            alert('Picker added successfully!\n\n(Note: API integration pending)');
        }

        closePickerModal();
        loadPickers();

    } catch (error) {
        console.error('[Pickers] Error saving picker:', error);
        alert('Error saving picker: ' + error.message);
    }
};

// Delete Picker
function deletePicker(pickerId, pickerName) {
    if (!confirm(`Are you sure you want to delete picker "${pickerName}"?`)) {
        return;
    }

    console.log('[Pickers] Deleting picker:', pickerId);

    // For now, just show a message since we don't have DELETE endpoint
    // In production, you would call the API here
    alert('Picker deleted successfully!\n\n(Note: API integration pending)');
    loadPickers();
}

console.log('[Pickers] ✅ Module loaded');

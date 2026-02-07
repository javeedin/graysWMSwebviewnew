// ============================================================================
// API LOG - Webservice Documentation Page
// ============================================================================
// This file contains all API endpoints used across the WMS application
// Each endpoint is documented with its page, feature, method, parameters,
// and whether it uses the Instance Name parameter

// Global variables
let apiLogGrid = null;
let allAPIEndpoints = [];

// ============================================================================
// API ENDPOINTS DATA
// ============================================================================

const API_ENDPOINTS_DATA = [
    // ========================================
    // TRIP MANAGEMENT PAGE
    // ========================================
    {
        page: 'Trip Management',
        feature: 'Fetch Trips',
        endpoint: 'WAREHOUSEMANAGEMENT/GETTRIPDETAILS',
        fullUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/GETTRIPDETAILS',
        method: 'GET',
        parameters: 'P_DATE_FROM, P_DATE_TO, P_INSTANCE_NAME',
        usesInstanceName: 'YES',
        sourceFile: 'app.js',
        lineNumber: 1385,
        description: 'Fetches trip details with orders for the specified date range and instance'
    },
    {
        page: 'Trip Management',
        feature: 'Update Pick Confirm Status',
        endpoint: 'TRIPMANAGEMENT/trip/updatepickconfirmstatus',
        fullUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/updatepickconfirmstatus',
        method: 'POST',
        parameters: 'P_TRANSACTION_ID, p_instance_name, p_pickedQty',
        usesInstanceName: 'YES',
        sourceFile: 'wms/app.js',
        lineNumber: 8799,
        description: 'Updates pick confirm status in the database after successful Oracle Fusion pick confirm'
    },

    // ========================================
    // TRIP DETAILS PAGE (Add Orders Modal)
    // ========================================
    {
        page: 'Trip Details',
        feature: 'Load Pending Orders (Add Orders Modal)',
        endpoint: 'WAREHOUSEMANAGEMENT/trips/getpendingorders',
        fullUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/getpendingorders',
        method: 'GET',
        parameters: 'instance',
        usesInstanceName: 'YES',
        sourceFile: 'wms/trip-details.js',
        lineNumber: 449,
        description: 'Fetches pending orders available to add to a trip, filtered by instance name'
    },
    {
        page: 'Trip Details',
        feature: 'Add Orders to Trip',
        endpoint: 'WAREHOUSEMANAGEMENT/trips/addtotrip',
        fullUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/addtotrip',
        method: 'POST',
        parameters: 'trip_id, orders (array)',
        usesInstanceName: 'NO',
        sourceFile: 'wms/trip-details.js',
        lineNumber: 568,
        description: 'Adds selected orders to a trip'
    },

    // ========================================
    // PENDING SHIPMENT LINES PAGE
    // ========================================
    {
        page: 'Pending Shipment Lines',
        feature: 'Load Initial Data (On Page Open)',
        endpoint: 'WAREHOUSEMANAGEMENT/trips/getpendingorders',
        fullUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/getpendingorders',
        method: 'GET',
        parameters: 'instance',
        usesInstanceName: 'YES',
        sourceFile: 'wms/pending-shipment-lines.js',
        lineNumber: 127,
        description: 'Loads pending orders when page opens, using instance from main dropdown'
    },
    {
        page: 'Pending Shipment Lines',
        feature: 'Fetch Shipment Lines (With Filters)',
        endpoint: 'WAREHOUSEMANAGEMENT/getpendingshipmentlines',
        fullUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/getpendingshipmentlines',
        method: 'POST',
        parameters: 'p_instance_name, P2_ORG_D, P2_DATE_FROM_D, P2_DATE_TO_D (in request body)',
        usesInstanceName: 'YES',
        sourceFile: 'wms/pending-shipment-lines.js',
        lineNumber: 235,
        description: 'Fetches pending shipment lines filtered by organization and date range (POST with JSON body)'
    },

    // ========================================
    // MONITOR PRINTING PAGE
    // ========================================
    {
        page: 'Monitor Printing',
        feature: 'Load Printers for Selection',
        endpoint: '/printers/all',
        fullUrl: 'APEX_BASE_URL + /printers/all',
        method: 'GET',
        parameters: 'None',
        usesInstanceName: 'NO',
        sourceFile: 'monitor-printing.js',
        lineNumber: 62,
        description: 'Gets all configured printers for the printer selection dropdown'
    },
    {
        page: 'Monitor Printing',
        feature: 'Enable Auto-Print',
        endpoint: '/monitor-printing/enable',
        fullUrl: 'APEX_BASE_URL + /monitor-printing/enable',
        method: 'POST',
        parameters: 'tripId, tripDate, orderCount, printerConfigId, printerName',
        usesInstanceName: 'NO',
        sourceFile: 'monitor-printing.js',
        lineNumber: 110,
        description: 'Enables auto-print for a specific trip with selected printer'
    },
    {
        page: 'Monitor Printing',
        feature: 'Load Monitoring Trips',
        endpoint: '/monitor-printing/list',
        fullUrl: 'APEX_BASE_URL + /monitor-printing/list',
        method: 'GET',
        parameters: 'fromDate, toDate',
        usesInstanceName: 'NO',
        sourceFile: 'monitor-printing.js',
        lineNumber: 171,
        description: 'Gets list of trips being monitored for auto-print'
    },
    {
        page: 'Monitor Printing',
        feature: 'Disable Auto-Print',
        endpoint: '/monitor-printing/disable',
        fullUrl: 'APEX_BASE_URL + /monitor-printing/disable',
        method: 'POST',
        parameters: 'tripId, tripDate',
        usesInstanceName: 'NO',
        sourceFile: 'monitor-printing.js',
        lineNumber: 374,
        description: 'Disables auto-print monitoring for a specific trip'
    },

    // ========================================
    // PRINTER SETUP NEW PAGE
    // ========================================
    {
        page: 'Printer Setup New',
        feature: 'Load All Printers',
        endpoint: '/printers/all',
        fullUrl: 'APEX_BASE_URL + /printers/all',
        method: 'GET',
        parameters: 'None',
        usesInstanceName: 'NO',
        sourceFile: 'printer-management-new.js',
        lineNumber: 82,
        description: 'Retrieves all configured printers from the database'
    },
    {
        page: 'Printer Setup New',
        feature: 'Save Printer Configuration',
        endpoint: '/config/printer',
        fullUrl: 'APEX_BASE_URL + /config/printer',
        method: 'POST',
        parameters: 'printerName, paperSize, orientation, fusionInstance, fusionUsername, fusionPassword, autoDownload, autoPrint',
        usesInstanceName: 'NO',
        sourceFile: 'printer-management-new.js',
        lineNumber: 384,
        description: 'Saves a new printer configuration to the database (fusionInstance is for printer config, not API filtering)'
    },
    {
        page: 'Printer Setup New',
        feature: 'Set Active Printer',
        endpoint: '/printers/set-active',
        fullUrl: 'APEX_BASE_URL + /printers/set-active',
        method: 'POST',
        parameters: 'configId',
        usesInstanceName: 'NO',
        sourceFile: 'printer-management-new.js',
        lineNumber: 421,
        description: 'Sets a printer as the active default printer'
    },
    {
        page: 'Printer Setup New',
        feature: 'Delete Printer',
        endpoint: '/printers/delete',
        fullUrl: 'APEX_BASE_URL + /printers/delete',
        method: 'POST',
        parameters: 'configId',
        usesInstanceName: 'NO',
        sourceFile: 'printer-management-new.js',
        lineNumber: 450,
        description: 'Deletes a printer configuration from the database'
    },

    // ========================================
    // LOCAL C# BACKEND ACTIONS (Not REST APIs)
    // ========================================
    {
        page: 'App (Global)',
        feature: 'Get All Print Jobs',
        endpoint: 'getAllPrintJobs',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'None',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 59,
        description: 'Gets all print jobs from local C# backend'
    },
    {
        page: 'App (Global)',
        feature: 'Get PDF as Base64',
        endpoint: 'getPdfAsBase64',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'filePath',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 571,
        description: 'Converts a PDF file to Base64 for preview'
    },
    {
        page: 'App (Global)',
        feature: 'Open File in Explorer',
        endpoint: 'openFileInExplorer',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'filePath',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 614,
        description: 'Opens the file location in Windows Explorer'
    },
    {
        page: 'App (Global)',
        feature: 'Enable/Disable Auto Print',
        endpoint: 'enableAutoPrint / disableAutoPrint',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'tripId, tripDate, enabled, orders',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 861,
        description: 'Toggles auto-print status for a trip in the local system'
    },
    {
        page: 'App (Global)',
        feature: 'Get Print Jobs',
        endpoint: 'getPrintJobs',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'None',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 911,
        description: 'Retrieves print jobs from local queue'
    },
    {
        page: 'App (Global)',
        feature: 'Download Order PDF',
        endpoint: 'downloadOrderPdf',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'job (order details)',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 1049,
        description: 'Downloads PDF for a specific order'
    },
    {
        page: 'App (Global)',
        feature: 'Print Order',
        endpoint: 'printOrder',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'job (order details)',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 1067,
        description: 'Sends an order to the printer'
    },
    {
        page: 'App (Global)',
        feature: 'Test Printer',
        endpoint: 'testPrinter',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'printerName',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 1100,
        description: 'Tests if a printer is working correctly'
    },
    {
        page: 'App (Global)',
        feature: 'Configure Printer',
        endpoint: 'configurePrinter',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'printerName, paperSize, orientation, autoPrint',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 1127,
        description: 'Saves printer configuration locally'
    },
    {
        page: 'App (Global)',
        feature: 'Get Printer Config',
        endpoint: 'getPrinterConfig',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'None',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 1140,
        description: 'Retrieves current printer configuration'
    },
    {
        page: 'App (Global)',
        feature: 'Get Installed Printers',
        endpoint: 'getInstalledPrinters',
        fullUrl: 'C# Backend Action',
        method: 'LOCAL',
        parameters: 'None',
        usesInstanceName: 'N/A',
        sourceFile: 'app.js',
        lineNumber: 1160,
        description: 'Gets list of printers installed on the system'
    }
];

// ============================================================================
// INITIALIZE API LOG PAGE
// ============================================================================

function initializeAPILogPage() {
    allAPIEndpoints = [...API_ENDPOINTS_DATA];

    // Update summary cards
    updateAPISummaryCards();

    // Populate page filter dropdown
    populatePageFilter();

    // Initialize the grid
    initializeAPILogGrid();
}

function updateAPISummaryCards() {
    const total = allAPIEndpoints.length;
    const withInstance = allAPIEndpoints.filter(a => a.usesInstanceName === 'YES').length;
    const withoutInstance = allAPIEndpoints.filter(a => a.usesInstanceName === 'NO').length;
    const localActions = allAPIEndpoints.filter(a => a.usesInstanceName === 'N/A').length;

    document.getElementById('api-total-count').textContent = total;
    document.getElementById('api-instance-yes').textContent = withInstance;
    document.getElementById('api-instance-no').textContent = withoutInstance;
    document.getElementById('api-local-count').textContent = localActions;
}

function populatePageFilter() {
    const pages = [...new Set(allAPIEndpoints.map(a => a.page))];
    const select = document.getElementById('api-page-filter');

    pages.forEach(page => {
        const option = document.createElement('option');
        option.value = page;
        option.textContent = page;
        select.appendChild(option);
    });
}

// ============================================================================
// DEVEXTREME GRID
// ============================================================================

function initializeAPILogGrid() {
    apiLogGrid = $('#api-log-grid').dxDataGrid({
        dataSource: allAPIEndpoints,
        showBorders: true,
        showRowLines: true,
        rowAlternationEnabled: true,
        columnAutoWidth: false,
        wordWrapEnabled: true,
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
            width: 300,
            placeholder: 'Search endpoints...'
        },
        headerFilter: {
            visible: true
        },
        filterRow: {
            visible: false
        },
        groupPanel: {
            visible: true
        },
        grouping: {
            autoExpandAll: true
        },
        export: {
            enabled: true,
            fileName: 'WMS_API_Documentation'
        },
        columns: [
            {
                dataField: 'page',
                caption: 'Page',
                width: 150,
                groupIndex: 0,
                cellTemplate: function(container, options) {
                    container.append(
                        $('<span>').css({
                            'font-weight': '600',
                            'color': '#4a5568'
                        }).text(options.value)
                    );
                }
            },
            {
                dataField: 'feature',
                caption: 'Feature',
                width: 180,
                cellTemplate: function(container, options) {
                    container.append(
                        $('<span>').css({
                            'font-weight': '500',
                            'color': '#2d3748'
                        }).text(options.value)
                    );
                }
            },
            {
                dataField: 'endpoint',
                caption: 'Endpoint',
                width: 250,
                cellTemplate: function(container, options) {
                    container.append(
                        $('<code>').css({
                            'background': '#f7fafc',
                            'padding': '4px 8px',
                            'border-radius': '4px',
                            'font-size': '12px',
                            'color': '#553c9a',
                            'display': 'inline-block',
                            'max-width': '100%',
                            'word-break': 'break-all'
                        }).text(options.value)
                    );
                }
            },
            {
                dataField: 'method',
                caption: 'Method',
                width: 90,
                alignment: 'center',
                cellTemplate: function(container, options) {
                    const colors = {
                        'GET': { bg: '#c6f6d5', color: '#22543d' },
                        'POST': { bg: '#fed7aa', color: '#9c4221' },
                        'LOCAL': { bg: '#e9d8fd', color: '#553c9a' }
                    };
                    const style = colors[options.value] || { bg: '#e2e8f0', color: '#4a5568' };

                    container.append(
                        $('<span>').css({
                            'background': style.bg,
                            'color': style.color,
                            'padding': '4px 10px',
                            'border-radius': '12px',
                            'font-size': '11px',
                            'font-weight': '700',
                            'display': 'inline-block'
                        }).text(options.value)
                    );
                }
            },
            {
                dataField: 'parameters',
                caption: 'Parameters',
                width: 220,
                cellTemplate: function(container, options) {
                    if (options.value === 'None') {
                        container.append(
                            $('<span>').css({ 'color': '#a0aec0', 'font-style': 'italic' }).text('None')
                        );
                    } else {
                        container.append(
                            $('<span>').css({
                                'font-size': '12px',
                                'color': '#4a5568',
                                'word-break': 'break-word'
                            }).text(options.value)
                        );
                    }
                }
            },
            {
                dataField: 'usesInstanceName',
                caption: 'Instance Name',
                width: 130,
                alignment: 'center',
                cellTemplate: function(container, options) {
                    let badge = '';

                    if (options.value === 'YES') {
                        badge = $('<span>').css({
                            'background': '#c6f6d5',
                            'color': '#22543d',
                            'padding': '4px 12px',
                            'border-radius': '12px',
                            'font-size': '11px',
                            'font-weight': '600'
                        }).html('<i class="fas fa-check"></i> YES');
                    } else if (options.value === 'NO') {
                        badge = $('<span>').css({
                            'background': '#fed7d7',
                            'color': '#9b2c2c',
                            'padding': '4px 12px',
                            'border-radius': '12px',
                            'font-size': '11px',
                            'font-weight': '600'
                        }).html('<i class="fas fa-times"></i> NO');
                    } else {
                        badge = $('<span>').css({
                            'background': '#e2e8f0',
                            'color': '#718096',
                            'padding': '4px 12px',
                            'border-radius': '12px',
                            'font-size': '11px',
                            'font-weight': '600'
                        }).text('N/A');
                    }

                    container.append(badge);
                }
            },
            {
                dataField: 'sourceFile',
                caption: 'Source',
                width: 180,
                cellTemplate: function(container, options) {
                    const data = options.data;
                    container.append(
                        $('<span>').css({
                            'font-family': 'monospace',
                            'font-size': '11px',
                            'color': '#667eea'
                        }).text(`${data.sourceFile}:${data.lineNumber}`)
                    );
                }
            },
            {
                dataField: 'description',
                caption: 'Description',
                minWidth: 250,
                cellTemplate: function(container, options) {
                    container.append(
                        $('<span>').css({
                            'font-size': '12px',
                            'color': '#718096'
                        }).text(options.value)
                    );
                }
            }
        ],
        onContentReady: function(e) {
            const count = e.component.totalCount();
            document.getElementById('api-filtered-count').textContent =
                `${count} endpoint${count !== 1 ? 's' : ''}`;
        }
    }).dxDataGrid('instance');
}

// ============================================================================
// FILTER FUNCTIONS
// ============================================================================

window.filterAPILog = function() {
    const pageFilter = document.getElementById('api-page-filter').value;
    const instanceFilter = document.getElementById('api-instance-filter').value;
    const methodFilter = document.getElementById('api-method-filter').value;

    let filtered = [...API_ENDPOINTS_DATA];

    if (pageFilter) {
        filtered = filtered.filter(a => a.page === pageFilter);
    }

    if (instanceFilter) {
        if (instanceFilter === 'yes') {
            filtered = filtered.filter(a => a.usesInstanceName === 'YES');
        } else if (instanceFilter === 'no') {
            filtered = filtered.filter(a => a.usesInstanceName === 'NO');
        } else if (instanceFilter === 'local') {
            filtered = filtered.filter(a => a.usesInstanceName === 'N/A');
        }
    }

    if (methodFilter) {
        filtered = filtered.filter(a => a.method === methodFilter);
    }

    if (apiLogGrid) {
        apiLogGrid.option('dataSource', filtered);
        apiLogGrid.refresh();
    }
};

window.resetAPIFilters = function() {
    document.getElementById('api-page-filter').value = '';
    document.getElementById('api-instance-filter').value = '';
    document.getElementById('api-method-filter').value = '';

    if (apiLogGrid) {
        apiLogGrid.option('dataSource', API_ENDPOINTS_DATA);
        apiLogGrid.refresh();
    }
};

// ============================================================================
// INITIALIZATION ON PAGE LOAD
// ============================================================================

$(document).ready(function() {
    console.log('[API Log] API Log module loaded');

    // Initialize when navigating to API Log page
    $(document).on('click', '.menu-item[data-page="api-log"]', function() {
        setTimeout(function() {
            if (!apiLogGrid) {
                initializeAPILogPage();
            }
        }, 100);
    });
});

console.log('[API Log] api-log.js loaded');

// ============================================================================
// PRINTER MANAGEMENT NEW - APEX REST API Integration
// ============================================================================

// Get API base URL from config
const APEX_API_BASE_URL_NEW = (typeof API_CONFIG !== 'undefined') ? API_CONFIG.APEX_BASE_URL : 'https://your-apex-url/ords/workspace/wms/v1';

// Global variable to store printers grid
let printersGridNew = null;
let allPrintersDataNew = [];

// ============================================================================
// CONFIGURATION API
// ============================================================================

async function callApexAPINew(endpoint, method = 'GET', body = null) {
    const url = `${APEX_API_BASE_URL_NEW}${endpoint}`;

    try {
        console.log(`[API NEW] ${method} ${url}`, body || '');

        // Use C# bridge with the global callback system (window.pendingRequests)
        return await new Promise((resolve, reject) => {
            const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            // Initialize pendingRequests if not exists
            if (!window.pendingRequests) {
                window.pendingRequests = {};
            }

            // Register callback in the global system
            window.pendingRequests[requestId] = (error, data) => {
                if (error) {
                    console.error('[API NEW] Error:', error);
                    reject(new Error(error));
                } else {
                    try {
                        // Parse if string
                        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log('[API NEW] Response:', parsedData);
                        resolve(parsedData);
                    } catch (parseError) {
                        console.error('[API NEW] ❌ JSON Parse Error:', parseError);
                        console.warn('========================================');
                        console.warn('[API NEW] 📄 RAW DATA (BROKEN JSON):');
                        console.warn('========================================');
                        console.warn(data);
                        console.warn('========================================');
                        console.warn('Character at position 56:', data ? data.substring(50, 65) : 'N/A');
                        console.warn('========================================');
                        reject(new Error(`JSON Parse Error: ${parseError.message}. Check console for raw data.`));
                    }
                }
            };

            // Send request to C# backend
            if (method === 'GET') {
                window.chrome.webview.postMessage({
                    action: 'executeGet',
                    requestId: requestId,
                    fullUrl: url
                });
            } else if (method === 'POST') {
                window.chrome.webview.postMessage({
                    action: 'executePost',
                    requestId: requestId,
                    fullUrl: url,
                    body: JSON.stringify(body || {})
                });
            }

            // Timeout after 60 seconds (increased for slow APEX responses)
            setTimeout(() => {
                if (window.pendingRequests[requestId]) {
                    delete window.pendingRequests[requestId];
                    reject(new Error(`Request timeout after 60s: ${method} ${url}`));
                }
            }, 60000);
        });
    } catch (error) {
        console.error('[API NEW] Error:', error);
        throw error;
    }
}

// ============================================================================
// LOAD ALL PRINTERS
// ============================================================================

window.loadAllPrintersNew = async function() {
    try {
        console.log('[Printers NEW] Loading all printers...');

        const data = await callApexAPINew('/printers/all');

        // DEBUG: Log the entire response structure
        console.log('[Printers NEW] ========================================');
        console.log('[Printers NEW] Full API Response:', data);
        console.log('[Printers NEW] Response type:', typeof data);
        console.log('[Printers NEW] Response keys:', data ? Object.keys(data) : 'null');
        console.log('[Printers NEW] data.items:', data.items);
        console.log('[Printers NEW] data.items type:', typeof data.items);
        console.log('[Printers NEW] ========================================');

        allPrintersDataNew = data.items || [];

        console.log(`[Printers NEW] Loaded ${allPrintersDataNew.length} printers`);

        // Update counter
        document.getElementById('printer-count-display-new').textContent =
            `${allPrintersDataNew.length} printer${allPrintersDataNew.length !== 1 ? 's' : ''}`;

        // Initialize/update grid
        if (!printersGridNew) {
            initializePrintersGridNew();
        } else {
            updatePrintersGridNew();
        }

    } catch (error) {
        console.error('[Printers NEW] Failed to load:', error);
        alert('Failed to load printers: ' + error.message);
    }
};

// ============================================================================
// INITIALIZE DEVEXTREME GRID
// ============================================================================

function initializePrintersGridNew() {
    printersGridNew = $('#printers-grid-new').dxDataGrid({
        dataSource: allPrintersDataNew,
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
            width: 300,
            placeholder: 'Search printers...'
        },
        headerFilter: {
            visible: true
        },
        filterRow: {
            visible: false
        },
        export: {
            enabled: true,
            fileName: 'Printers'
        },
        columns: [
            {
                dataField: 'printerName',
                caption: 'Printer Name',
                minWidth: 200,
                cellTemplate: function(container, options) {
                    const isActive = options.data.isActive === 'Y';
                    container.append(
                        $('<div>').css({
                            'display': 'flex',
                            'align-items': 'center',
                            'gap': '8px'
                        }).append(
                            isActive ? $('<span>').css({
                                'background': '#28a745',
                                'color': 'white',
                                'padding': '2px 6px',
                                'border-radius': '4px',
                                'font-size': '11px',
                                'font-weight': 'bold'
                            }).text('ACTIVE') : null,
                            $('<span>').text(options.value)
                        )
                    );
                }
            },
            {
                dataField: 'printerShortName',
                caption: 'Short Name',
                width: 120,
                cellTemplate: function(container, options) {
                    if (options.value) {
                        container.append(
                            $('<span>').css({
                                'color': '#333',
                                'font-weight': '600',
                                'background': '#e3f2fd',
                                'padding': '4px 8px',
                                'border-radius': '4px',
                                'display': 'inline-block'
                            }).text(options.value)
                        );
                    } else {
                        container.append(
                            $('<span>').css({
                                'color': '#999',
                                'font-style': 'italic'
                            }).text('N/A')
                        );
                    }
                }
            },
            {
                dataField: 'printerIp',
                caption: 'IP Address',
                width: 150,
                cellTemplate: function(container, options) {
                    if (options.value) {
                        container.append(
                            $('<span>').css({
                                'color': '#666',
                                'font-family': 'monospace'
                            }).text(options.value)
                        );
                    } else {
                        container.append(
                            $('<span>').css({
                                'color': '#999',
                                'font-style': 'italic'
                            }).text('N/A')
                        );
                    }
                }
            },
            {
                dataField: 'paperSize',
                caption: 'Paper Size',
                width: 100
            },
            {
                dataField: 'orientation',
                caption: 'Orientation',
                width: 100
            },
            {
                dataField: 'autoDownload',
                caption: 'Auto Download',
                width: 120,
                cellTemplate: function(container, options) {
                    container.append(
                        $('<i>').addClass(options.value === 'Y' ? 'fas fa-check-circle' : 'fas fa-times-circle')
                            .css('color', options.value === 'Y' ? '#28a745' : '#dc3545')
                            .css('font-size', '16px')
                    );
                }
            },
            {
                dataField: 'autoPrint',
                caption: 'Auto Print',
                width: 100,
                cellTemplate: function(container, options) {
                    container.append(
                        $('<i>').addClass(options.value === 'Y' ? 'fas fa-check-circle' : 'fas fa-times-circle')
                            .css('color', options.value === 'Y' ? '#28a745' : '#dc3545')
                            .css('font-size', '16px')
                    );
                }
            },
            {
                dataField: 'createdDate',
                caption: 'Created',
                width: 150,
                dataType: 'datetime',
                format: 'yyyy-MM-dd HH:mm'
            },
            {
                caption: 'Actions',
                width: 220,
                cellTemplate: function(container, options) {
                    const isActive = options.data.isActive === 'Y';

                    container.css({
                        'display': 'flex',
                        'gap': '5px',
                        'justify-content': 'center',
                        'align-items': 'center'
                    });

                    // Set Active Button (only if not already active)
                    if (!isActive) {
                        container.append(
                            $('<button>').addClass('btn btn-sm').css({
                                'font-size': '12px',
                                'padding': '4px 8px',
                                'background': '#28a745',
                                'color': 'white',
                                'border': 'none'
                            }).html('<i class="fas fa-check"></i> Set Active')
                            .on('click', function() {
                                setActivePrinterNew(options.data.configId);
                            })
                        );
                    }

                    // Test Button
                    container.append(
                        $('<button>').addClass('btn btn-sm').css({
                            'font-size': '12px',
                            'padding': '4px 8px',
                            'background': '#007bff',
                            'color': 'white',
                            'border': 'none'
                        }).html('<i class="fas fa-print"></i> Test')
                        .on('click', function() {
                            testPrinterNew(options.data.printerName);
                        })
                    );

                    // Delete Button (only if not active)
                    if (!isActive) {
                        container.append(
                            $('<button>').addClass('btn btn-sm').css({
                                'font-size': '12px',
                                'padding': '4px 8px',
                                'background': '#dc3545',
                                'color': 'white',
                                'border': 'none'
                            }).html('<i class="fas fa-trash"></i>')
                            .on('click', function() {
                                deletePrinterNew(options.data.configId, options.data.printerName);
                            })
                        );
                    }
                }
            }
        ]
    }).dxDataGrid('instance');
}

function updatePrintersGridNew() {
    if (printersGridNew) {
        printersGridNew.option('dataSource', allPrintersDataNew);
        printersGridNew.refresh();
    }
}

// ============================================================================
// ADD PRINTER MODAL
// ============================================================================

window.showAddPrinterModalNew = function() {
    document.getElementById('printer-modal-title-new').textContent = 'Add New Printer';
    document.getElementById('edit-printer-id-new').value = '';

    // Reset form
    document.getElementById('modal-printer-select-new').value = '';
    document.getElementById('modal-printer-ip-new').value = '';
    document.getElementById('modal-printer-short-name-new').value = '';
    document.getElementById('modal-paper-size-new').value = 'A4';
    document.getElementById('modal-orientation-new').value = 'Portrait';
    document.getElementById('modal-auto-download-new').checked = true;
    document.getElementById('modal-auto-print-new').checked = true;

    // Load installed printers into dropdown
    loadInstalledPrintersIntoModalNew();

    // Show modal
    document.getElementById('printer-modal-new').style.display = 'flex';
};

window.closePrinterModalNew = function() {
    document.getElementById('printer-modal-new').style.display = 'none';
};

function loadInstalledPrintersIntoModalNew() {
    sendMessageToCSharp({
        action: 'getInstalledPrinters'
    }, function(error, response) {
        const select = document.getElementById('modal-printer-select-new');
        select.innerHTML = '<option value="">Select a printer...</option>';

        if (!error && response && response.printers) {
            response.printers.forEach(function(printer) {
                const option = document.createElement('option');
                option.value = printer;
                option.textContent = printer;
                select.appendChild(option);
            });
        }
    });
}

// ============================================================================
// SAVE PRINTER FROM MODAL
// ============================================================================

window.savePrinterFromModalNew = async function() {
    const printerName = document.getElementById('modal-printer-select-new').value;
    const printerIp = document.getElementById('modal-printer-ip-new').value;
    const printerShortName = document.getElementById('modal-printer-short-name-new').value;
    const paperSize = document.getElementById('modal-paper-size-new').value;
    const orientation = document.getElementById('modal-orientation-new').value;
    const autoDownload = document.getElementById('modal-auto-download-new').checked ? 'Y' : 'N';
    const autoPrint = document.getElementById('modal-auto-print-new').checked ? 'Y' : 'N';

    // Validation
    if (!printerName) {
        alert('Please select a printer');
        return;
    }

    if (!printerShortName || printerShortName.trim() === '') {
        alert('Please enter a Short Name for the printer');
        return;
    }

    try {
        console.log('[Printers NEW] Saving printer configuration...');

        const requestBody = {
            printerName: printerName,
            printerShortName: printerShortName.trim(),
            paperSize: paperSize,
            orientation: orientation,
            autoDownload: autoDownload,
            autoPrint: autoPrint
        };

        // Add IP address if provided
        if (printerIp && printerIp.trim() !== '') {
            requestBody.printerIp = printerIp.trim();
        }

        const result = await callApexAPINew('/config/printer', 'POST', requestBody);

        if (result.status === 'success') {
            alert('✓ Printer configuration saved successfully!');
            closePrinterModalNew();
            loadAllPrintersNew(); // Reload the grid
        } else {
            alert('Failed to save printer: ' + result.message);
        }

    } catch (error) {
        console.error('[Printers NEW] Failed to save:', error);
        alert('Failed to save printer: ' + error.message);
    }
};

// ============================================================================
// SET ACTIVE PRINTER
// ============================================================================

async function setActivePrinterNew(configId) {
    if (!confirm('Set this printer as active? This will deactivate the current active printer.')) {
        return;
    }

    try {
        console.log('[Printers NEW] Setting active printer:', configId);

        const result = await callApexAPINew('/printers/set-active', 'POST', {
            configId: configId
        });

        if (result.status === 'success') {
            alert('✓ Printer set as active successfully!');
            loadAllPrintersNew(); // Reload the grid
        } else {
            alert('Failed to set active printer: ' + result.message);
        }

    } catch (error) {
        console.error('[Printers NEW] Failed to set active:', error);
        alert('Failed to set active printer: ' + error.message);
    }
}

// ============================================================================
// DELETE PRINTER
// ============================================================================

async function deletePrinterNew(configId, printerName) {
    if (!confirm(`Delete printer "${printerName}"?\n\nThis action cannot be undone.`)) {
        return;
    }

    try {
        console.log('[Printers NEW] Deleting printer:', configId);

        const result = await callApexAPINew('/printers/delete', 'POST', {
            configId: configId
        });

        if (result.status === 'success') {
            alert('✓ Printer deleted successfully!');
            loadAllPrintersNew(); // Reload the grid
        } else {
            alert('Failed to delete printer: ' + result.message);
        }

    } catch (error) {
        console.error('[Printers NEW] Failed to delete:', error);
        alert('Failed to delete printer: ' + error.message);
    }
}

// ============================================================================
// TEST PRINTER (via C# backend)
// ============================================================================

function testPrinterNew(printerName) {
    console.log('[Printers NEW] Testing printer:', printerName);

    sendMessageToCSharp({
        action: 'testPrinter',
        printerName: printerName
    }, function(error, response) {
        if (error) {
            alert('Printer test failed: ' + error);
            return;
        }
        alert(response.success ? '✓ Printer test successful!' : '✗ Printer test failed:\n\n' + response.message);
    });
}

// ============================================================================
// PRINTER DISCOVERY FUNCTIONS
// ============================================================================

window.discoverBluetoothPrinters = function() {
    console.log('[Printers NEW] Discovering Bluetooth printers...');

    sendMessageToCSharp({
        action: 'discoverBluetoothPrinters'
    }, function(error, response) {
        if (error) {
            alert('Bluetooth printer discovery failed:\n\n' + error);
            return;
        }

        if (response && response.printers && response.printers.length > 0) {
            // Add discovered printers to the dropdown
            const select = document.getElementById('modal-printer-select-new');
            response.printers.forEach(function(printer) {
                // Check if printer already exists in dropdown
                const exists = Array.from(select.options).some(opt => opt.value === printer);
                if (!exists) {
                    const option = document.createElement('option');
                    option.value = printer;
                    option.textContent = printer + ' (Bluetooth)';
                    select.appendChild(option);
                }
            });
            alert(`✓ Found ${response.printers.length} Bluetooth printer(s)!\n\nThey have been added to the printer list.`);
        } else {
            alert('No Bluetooth printers found.\n\nPlease ensure:\n• Bluetooth is enabled\n• Printers are paired\n• Printers are powered on');
        }
    });
};

window.discoverWifiPrinters = function() {
    console.log('[Printers NEW] Discovering WiFi/Network printers...');

    sendMessageToCSharp({
        action: 'discoverWifiPrinters'
    }, function(error, response) {
        if (error) {
            alert('WiFi printer discovery failed:\n\n' + error);
            return;
        }

        if (response && response.printers && response.printers.length > 0) {
            // Add discovered printers to the dropdown
            const select = document.getElementById('modal-printer-select-new');
            response.printers.forEach(function(printer) {
                // Check if printer already exists in dropdown
                const exists = Array.from(select.options).some(opt => opt.value === printer);
                if (!exists) {
                    const option = document.createElement('option');
                    option.value = printer;
                    option.textContent = printer + ' (Network)';
                    select.appendChild(option);
                }
            });
            alert(`✓ Found ${response.printers.length} WiFi/Network printer(s)!\n\nThey have been added to the printer list.`);
        } else {
            alert('No WiFi/Network printers found.\n\nPlease ensure:\n• Printers are connected to the network\n• Printers are powered on\n• Network discovery is enabled');
        }
    });
};

// ============================================================================
// TEST CURRENT PRINTER SELECTION
// ============================================================================

window.testCurrentPrinterSelection = function() {
    const printerName = document.getElementById('modal-printer-select-new').value;

    if (!printerName) {
        alert('Please select a printer first');
        return;
    }

    console.log('[Printers NEW] Testing selected printer:', printerName);

    sendMessageToCSharp({
        action: 'testPrinter',
        printerName: printerName
    }, function(error, response) {
        if (error) {
            alert('❌ Printer test failed:\n\n' + error);
            return;
        }

        if (response.success) {
            alert('✓ Printer test successful!\n\nA test page has been sent to:\n' + printerName);
        } else {
            alert('❌ Printer test failed:\n\n' + (response.message || 'Unknown error'));
        }
    });
};

// ============================================================================
// INITIALIZE ON PAGE LOAD
// ============================================================================

$(document).ready(function() {
    console.log('[Printers NEW] Printer management NEW module loaded');

    // Auto-load printers when navigating to printer setup new page
    $(document).on('click', '.menu-item[data-page="printer-setup-new"]', function() {
        setTimeout(function() {
            if (!printersGridNew) {
                loadAllPrintersNew();
            }
        }, 100);
    });
});

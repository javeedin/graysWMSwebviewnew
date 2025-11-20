// ========================================
// 🚀 WMS APPLICATION - MAIN JAVASCRIPT
// ========================================

console.log('[JS] 🚀 Starting WMS Application...');

// Global variables
let currentParams = { fromDate: '', toDate: '', instance: '' };
let currentFullData = [];
let currentVehiclesData = [];
window.currentFullData = currentFullData;
window.pendingRequests = {};

// Store Transactions Dialog Grid Instances
let transactionDetailsGrid = null;
let qohDetailsGrid = null;
let allocatedLotsGrid = null;

// ========================================
// INSTANCE MANAGEMENT
// ========================================

// Initialize instance from localStorage (default to PROD)
function initializeInstance() {
    const savedInstance = localStorage.getItem('fusionInstance') || 'PROD';
    document.getElementById('current-instance-display').textContent = savedInstance;

    // Update checkmarks
    document.getElementById('check-PROD').style.visibility = savedInstance === 'PROD' ? 'visible' : 'hidden';
    document.getElementById('check-TEST').style.visibility = savedInstance === 'TEST' ? 'visible' : 'hidden';

    console.log('[Instance] Initialized to:', savedInstance);
    return savedInstance;
}

// Toggle instance dropdown menu
window.toggleInstanceMenu = function() {
    const menu = document.getElementById('instance-dropdown-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
};

// Select instance
window.selectInstance = function(instance) {
    localStorage.setItem('fusionInstance', instance);
    document.getElementById('current-instance-display').textContent = instance;

    // Update checkmarks
    document.getElementById('check-PROD').style.visibility = instance === 'PROD' ? 'visible' : 'hidden';
    document.getElementById('check-TEST').style.visibility = instance === 'TEST' ? 'visible' : 'hidden';

    // Close menu
    document.getElementById('instance-dropdown-menu').style.display = 'none';

    console.log('[Instance] Changed to:', instance);

    // Sync to C# backend
    syncInstanceToBackend(instance);

    // Show notification
    const notification = document.createElement('div');
    notification.style.cssText = 'position: fixed; top: 80px; right: 20px; background: #667eea; color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10001; font-weight: 600; animation: slideIn 0.3s ease-out;';
    notification.innerHTML = `<i class="fas fa-check-circle"></i> Instance changed to <strong>${instance}</strong>`;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 2000);
};

// Sync instance setting to C# backend
function syncInstanceToBackend(instance) {
    if (typeof sendMessageToCSharp === 'function') {
        sendMessageToCSharp({
            action: 'setInstanceSetting',
            instance: instance
        }, function(error, response) {
            if (error) {
                console.error('[Instance] Failed to sync to backend:', error);
            } else {
                console.log('[Instance] Successfully synced to backend:', instance);
            }
        });
    } else {
        console.warn('[Instance] C# bridge not available, instance saved to localStorage only');
    }
}

// Get current instance
window.getCurrentInstance = function() {
    return localStorage.getItem('fusionInstance') || 'PROD';
};

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const selector = document.getElementById('instance-selector');
    const menu = document.getElementById('instance-dropdown-menu');

    if (selector && menu && !selector.contains(e.target) && !menu.contains(e.target)) {
        menu.style.display = 'none';
    }
});

// ========================================
// HELPER FUNCTIONS
// ========================================

function generateRequestId() {
    return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}



function sendMessageToCSharp(message, callback) {
    const requestId = message.requestId || generateRequestId();
    message.requestId = requestId;
    
    console.log('[JS] 📤 Sending to C#:', message.action, requestId);
    
    window.pendingRequests[requestId] = callback;
    
    if (window.chrome?.webview) {
        window.chrome.webview.postMessage(message);
        console.log('[JS] ✅ Message sent');
    } else {
        console.error('[JS] ❌ WebView2 not available');
        callback('WebView2 not available', null);
    }
}

// ============================================================
// ENHANCED MONITOR PRINTING JAVASCRIPT
// Add these functions to your app.js file
// ============================================================

// Global variables
let allPrintJobs = [];
let activeTripFilters = new Set();
let currentPdfPath = null;

/**
 * Load print jobs with complete details and actual status
 */
async function loadPrintJobs() {
    console.log('[Monitor] Loading print jobs...');
    
    try {
        const response = await sendMessageToCSharp({
            action: 'getAllPrintJobs',
            requestId: generateRequestId()
        });
        
        console.log('[Monitor] Print jobs loaded:', response);
        
        if (response.success && response.data) {
            allPrintJobs = response.data.jobs || [];
            
            // Update statistics
            updatePrintStatistics(allPrintJobs);
            
            // Create trip filters
            createTripFilters(allPrintJobs);
            
            // Display grid
            displayPrintJobsGrid(allPrintJobs);
        } else {
            console.error('[Monitor] Failed to load print jobs:', response.message);
            showNotification('Failed to load print jobs', 'error');
        }
    } catch (error) {
        console.error('[Monitor] Error loading print jobs:', error);
        showNotification('Error loading print jobs: ' + error.message, 'error');
    }
}

/**
 * Update statistics cards
 */
function updatePrintStatistics(jobs) {
    const stats = {
        total: jobs.length,
        pending: 0,
        downloaded: 0,
        printing: 0,
        completed: 0,
        failed: 0
    };
    
    jobs.forEach(job => {
        switch (job.status.toLowerCase()) {
            case 'pending':
                stats.pending++;
                break;
            case 'downloaded':
            case 'download completed':
                stats.downloaded++;
                break;
            case 'printing':
                stats.printing++;
                break;
            case 'completed':
            case 'printed':
                stats.completed++;
                break;
            case 'failed':
                stats.failed++;
                break;
        }
    });
    
    document.getElementById('stat-total-jobs').textContent = stats.total;
    document.getElementById('stat-pending-download').textContent = stats.pending;
    document.getElementById('stat-completed-download').textContent = stats.downloaded;
    document.getElementById('stat-pending-print').textContent = stats.printing;
    document.getElementById('stat-printed').textContent = stats.completed;
    document.getElementById('stat-failed').textContent = stats.failed;
}

/**
 * Create trip filter switches
 */
function createTripFilters(jobs) {
    console.log('[Monitor] Creating trip filters...');
    
    // Group jobs by trip
    const tripMap = new Map();
    jobs.forEach(job => {
        const key = `${job.tripId}_${job.tripDate}`;
        if (!tripMap.has(key)) {
            tripMap.set(key, {
                tripId: job.tripId,
                tripDate: job.tripDate,
                count: 0
            });
        }
        tripMap.get(key).count++;
    });
    
    const container = document.getElementById('trip-filters-container');
    container.innerHTML = '';
    
    if (tripMap.size === 0) {
        container.innerHTML = '<div style="color: #999; width: 100%; text-align: center; padding: 20px 0;">No trips found</div>';
        return;
    }
    
    // Sort trips by date (newest first)
    const sortedTrips = Array.from(tripMap.values()).sort((a, b) => {
        return new Date(b.tripDate) - new Date(a.tripDate);
    });
    
    sortedTrips.forEach(trip => {
        const tripKey = `${trip.tripId}_${trip.tripDate}`;
        const isActive = activeTripFilters.has(tripKey);
        
        const switchDiv = document.createElement('div');
        switchDiv.className = 'trip-filter-switch' + (isActive ? ' active' : '');
        switchDiv.onclick = () => toggleTripFilter(tripKey);
        
        switchDiv.innerHTML = `
            <i class="fas fa-truck trip-icon"></i>
            <span class="trip-name">${trip.tripId}</span>
            <span class="trip-count">${trip.count} orders</span>
        `;
        
        container.appendChild(switchDiv);
    });
    
    updateActiveTripCount();
}

/**
 * Toggle trip filter
 */
function toggleTripFilter(tripKey) {
    if (activeTripFilters.has(tripKey)) {
        activeTripFilters.delete(tripKey);
    } else {
        activeTripFilters.add(tripKey);
    }
    
    // Update UI
    const switches = document.querySelectorAll('.trip-filter-switch');
    switches.forEach(sw => {
        const tripId = sw.querySelector('.trip-name').textContent;
        const matchingKey = Array.from(activeTripFilters).find(k => k.startsWith(tripId + '_'));
        
        if (matchingKey || (sw.querySelector('.trip-name').textContent === tripId.split('_')[0] && 
            activeTripFilters.has(tripKey) && tripKey.startsWith(tripId + '_'))) {
            sw.classList.add('active');
        } else {
            sw.classList.remove('active');
        }
    });
    
    updateActiveTripCount();
    filterAndDisplayJobs();
}

/**
 * Select all trips
 */
function selectAllTrips() {
    activeTripFilters.clear();
    
    allPrintJobs.forEach(job => {
        const tripKey = `${job.tripId}_${job.tripDate}`;
        activeTripFilters.add(tripKey);
    });
    
    // Update all switches to active
    document.querySelectorAll('.trip-filter-switch').forEach(sw => {
        sw.classList.add('active');
    });
    
    updateActiveTripCount();
    filterAndDisplayJobs();
}

/**
 * Clear all trip filters
 */
function clearAllTrips() {
    activeTripFilters.clear();
    
    // Update all switches to inactive
    document.querySelectorAll('.trip-filter-switch').forEach(sw => {
        sw.classList.remove('active');
    });
    
    updateActiveTripCount();
    filterAndDisplayJobs();
}

/**
 * Update active trip count
 */
function updateActiveTripCount() {
    const count = activeTripFilters.size;
    const badge = document.getElementById('active-trip-count');
    badge.textContent = count === 0 ? 'All' : `${count} selected`;
}

/**
 * Filter jobs by status (from stat cards)
 */
function filterByStatus(status) {
    console.log('[Monitor] Filtering by status:', status);
    
    if (status === 'all') {
        displayPrintJobsGrid(getFilteredJobs());
        return;
    }
    
    const filtered = getFilteredJobs().filter(job => {
        const jobStatus = job.status.toLowerCase();
        
        switch (status) {
            case 'pending':
                return jobStatus === 'pending';
            case 'downloaded':
                return jobStatus === 'downloaded' || jobStatus === 'download completed';
            case 'printing':
                return jobStatus === 'printing';
            case 'completed':
                return jobStatus === 'completed' || jobStatus === 'printed';
            case 'failed':
                return jobStatus === 'failed';
            default:
                return true;
        }
    });
    
    displayPrintJobsGrid(filtered);
}

/**
 * Get filtered jobs based on active trip filters
 */
function getFilteredJobs() {
    if (activeTripFilters.size === 0) {
        return allPrintJobs;
    }
    
    return allPrintJobs.filter(job => {
        const tripKey = `${job.tripId}_${job.tripDate}`;
        return activeTripFilters.has(tripKey);
    });
}

/**
 * Filter and display jobs
 */
function filterAndDisplayJobs() {
    const filtered = getFilteredJobs();
    displayPrintJobsGrid(filtered);
}

/**
 * Display print jobs grid with DevExtreme
 */
function displayPrintJobsGrid(jobs) {
    console.log('[Monitor] Displaying', jobs.length, 'jobs');
    
    // Update filtered count
    document.getElementById('filtered-count').textContent = `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`;
    
    // Prepare data with formatted dates
    const gridData = jobs.map(job => ({
        ...job,
        tripDateFormatted: formatDate(job.tripDate),
        createdAtFormatted: formatDateTime(job.createdAt)
    }));
    
    const gridContainer = document.getElementById('print-jobs-grid');
    
    // Destroy existing grid
    if (gridContainer._grid) {
        gridContainer._grid.dispose();
    }
    
    // Create new grid
    const grid = $('#print-jobs-grid').dxDataGrid({
        dataSource: gridData,
        showBorders: true,
        showRowLines: true,
        showColumnLines: true,
        rowAlternationEnabled: true,
        columnAutoWidth: true,
        wordWrapEnabled: false,
        allowColumnResizing: true,
        columnResizingMode: 'widget',
        
        // Paging
        paging: {
            enabled: true,
            pageSize: 20
        },
        
        // Sorting
        sorting: {
            mode: 'multiple'
        },
        
        // Filtering
        filterRow: {
            visible: true,
            applyFilter: 'auto'
        },
        
        // Search panel
        searchPanel: {
            visible: true,
            width: 240,
            placeholder: 'Search...'
        },
        
        // Export
        export: {
            enabled: true,
            fileName: 'print-jobs'
        },
        
        // Selection
        selection: {
            mode: 'multiple',
            showCheckBoxesMode: 'always'
        },
        
        // Columns
        columns: [
            {
                dataField: 'orderNumber',
                caption: 'Order Number',
                width: 130,
                fixed: true,
                cellTemplate: function(container, options) {
                    $('<div>')
                        .css({
                            'font-weight': '600',
                            'color': '#667eea'
                        })
                        .text(options.value)
                        .appendTo(container);
                }
            },
            {
                dataField: 'tripId',
                caption: 'Trip ID',
                width: 120
            },
            {
                dataField: 'tripDateFormatted',
                caption: 'Trip Date',
                width: 120
            },
            {
                dataField: 'status',
                caption: 'Status',
                width: 140,
                cellTemplate: function(container, options) {
                    const status = (options.value || 'pending').toLowerCase();
                    let className = 'status-badge ';
                    
                    if (status === 'pending') className += 'status-pending';
                    else if (status === 'downloaded' || status === 'download completed') className += 'status-downloaded';
                    else if (status === 'printing') className += 'status-printing';
                    else if (status === 'completed' || status === 'printed') className += 'status-completed';
                    else if (status === 'failed') className += 'status-failed';
                    
                    $('<span>')
                        .addClass(className)
                        .text(options.value || 'Pending')
                        .appendTo(container);
                }
            },
            {
                dataField: 'filePath',
                caption: 'File Status',
                width: 120,
                cellTemplate: function(container, options) {
                    const hasFile = options.value && options.value !== '';
                    
                    $('<span>')
                        .css({
                            'color': hasFile ? '#28a745' : '#666',
                            'font-weight': hasFile ? '600' : 'normal'
                        })
                        .html(hasFile ? 
                            '<i class="fas fa-check-circle"></i> Downloaded' : 
                            '<i class="fas fa-minus-circle"></i> Not Downloaded')
                        .appendTo(container);
                }
            },
            {
                dataField: 'createdAtFormatted',
                caption: 'Created',
                width: 160
            },
            {
                dataField: 'errorMessage',
                caption: 'Error',
                width: 200,
                visible: false
            },
            {
                caption: 'Actions',
                width: 280,
                fixed: true,
                fixedPosition: 'right',
                cellTemplate: function(container, options) {
                    const data = options.data;
                    const hasFile = data.filePath && data.filePath !== '';
                    const status = (data.status || 'pending').toLowerCase();
                    const isFailed = status === 'failed';
                    
                    const actionsDiv = $('<div>')
                        .css({
                            'display': 'flex',
                            'gap': '6px',
                            'flex-wrap': 'wrap'
                        });
                    
                    // Download button
                    if (!hasFile || isFailed) {
                        $('<button>')
                            .addClass('grid-action-btn btn-download')
                            .html('<i class="fas fa-download"></i> Download')
                            .on('click', function() {
                                downloadOrderPdf(data.orderNumber, data.tripId, data.tripDate);
                            })
                            .appendTo(actionsDiv);
                    }
                    
                    // Preview button
                    if (hasFile) {
                        $('<button>')
                            .addClass('grid-action-btn btn-preview')
                            .html('<i class="fas fa-eye"></i> Preview')
                            .on('click', function() {
                                previewPdf(data.filePath, data.orderNumber, data.tripId);
                            })
                            .appendTo(actionsDiv);
                    }
                    
                    // Print button
                    if (hasFile) {
                        $('<button>')
                            .addClass('grid-action-btn btn-print')
                            .html('<i class="fas fa-print"></i> Print')
                            .on('click', function() {
                                printOrderPdf(data.orderNumber, data.tripId, data.tripDate);
                            })
                            .appendTo(actionsDiv);
                    }
                    
                    // Retry button for failed jobs
                    if (isFailed) {
                        $('<button>')
                            .addClass('grid-action-btn btn-retry')
                            .html('<i class="fas fa-redo"></i> Retry')
                            .on('click', function() {
                                downloadOrderPdf(data.orderNumber, data.tripId, data.tripDate);
                            })
                            .appendTo(actionsDiv);
                    }
                    
                    actionsDiv.appendTo(container);
                }
            }
        ],
        
        onToolbarPreparing: function(e) {
            e.toolbarOptions.items.unshift({
                location: 'after',
                widget: 'dxButton',
                options: {
                    icon: 'refresh',
                    text: 'Refresh',
                    onClick: function() {
                        // OLD: loadPrintJobs(); - Now uses APEX REST API
                        if (typeof loadMonitoringTrips === 'function') {
                            loadMonitoringTrips();
                        }
                    }
                }
            });
        }
    }).dxDataGrid('instance');
    
    gridContainer._grid = grid;
}

/**
 * Preview PDF
 */
async function previewPdf(filePath, orderNumber, tripId) {
    console.log('[Monitor] Previewing PDF:', filePath);
    
    if (!filePath || filePath === '') {
        showNotification('No PDF file available', 'error');
        return;
    }
    
    try {
        // Show modal
        const modal = document.getElementById('pdf-preview-modal');
        modal.style.display = 'flex';
        
        // Show loading
        document.getElementById('pdf-loading').style.display = 'block';
        
        // Update info
        document.getElementById('preview-order-info').textContent = 
            `Order: ${orderNumber} | Trip: ${tripId}`;
        document.getElementById('preview-file-info').textContent = 
            `File: ${filePath.split('\\').pop()}`;
        
        // Store current path for download
        currentPdfPath = filePath;
        
        // Request PDF as base64
        const response = await sendMessageToCSharp({
            action: 'getPdfAsBase64',
            requestId: generateRequestId(),
            filePath: filePath
        });
        
        if (response.success && response.data) {
            // Load PDF in iframe
            const iframe = document.getElementById('pdf-preview-iframe');
            iframe.src = `data:application/pdf;base64,${response.data.base64}`;
            
            // Hide loading
            document.getElementById('pdf-loading').style.display = 'none';
        } else {
            throw new Error(response.message || 'Failed to load PDF');
        }
    } catch (error) {
        console.error('[Monitor] Preview failed:', error);
        showNotification('Failed to preview PDF: ' + error.message, 'error');
        closePdfPreview();
    }
}

/**
 * Close PDF preview modal
 */
function closePdfPreview() {
    const modal = document.getElementById('pdf-preview-modal');
    modal.style.display = 'none';
    
    const iframe = document.getElementById('pdf-preview-iframe');
    iframe.src = '';
    
    currentPdfPath = null;
}

/**
 * Download current PDF from preview
 */
function downloadCurrentPdf() {
    if (!currentPdfPath) return;
    
    // Trigger download via C#
    sendMessageToCSharp({
        action: 'openFileInExplorer',
        requestId: generateRequestId(),
        filePath: currentPdfPath
    });
}

/**
 * Export print jobs to Excel
 */
async function exportPrintJobs() {
    const filtered = getFilteredJobs();
    
    if (filtered.length === 0) {
        showNotification('No jobs to export', 'warning');
        return;
    }
    
    // Use DevExtreme grid export if available
    const grid = document.getElementById('print-jobs-grid')._grid;
    if (grid) {
        grid.exportToExcel();
    }
}

/**
 * Format date
 */
function formatDate(dateString) {
    if (!dateString) return '-';
    
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        // If ISO format with time, extract date part
        if (dateString.includes('T')) {
            return dateString.split('T')[0];
        }
        return dateString;
    }
}

/**
 * Format date time
 */
function formatDateTime(dateString) {
    if (!dateString) return '-';
    
    try {
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return dateString;
    }
}

/**
 * Retry all failed jobs
 */
async function retryAllFailedJobs() {
    const failedJobs = allPrintJobs.filter(j => 
        (j.status || '').toLowerCase() === 'failed'
    );
    
    if (failedJobs.length === 0) {
        showNotification('No failed jobs to retry', 'info');
        return;
    }
    
    if (!confirm(`Retry ${failedJobs.length} failed job(s)?`)) {
        return;
    }
    
    showNotification(`Retrying ${failedJobs.length} jobs...`, 'info');
    
    for (const job of failedJobs) {
        await downloadOrderPdf(job.orderNumber, job.tripId, job.tripDate);
    }

    setTimeout(() => {
        // OLD: loadPrintJobs(); - Now uses APEX REST API
        if (typeof loadMonitoringTrips === 'function') {
            loadMonitoringTrips();
        }
        showNotification('Retry completed', 'success');
    }, 2000);
}

// ============================================================
// Monitor Printing Page Navigation (REMOVED OLD AUTO-LOAD)
// ============================================================

// NOTE: Monitor Printing now uses manual "Load Trips" button
// The old auto-refresh has been removed to avoid conflicts
// with the new APEX REST API in monitor-printing.js

document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', function() {
        const page = this.getAttribute('data-page');

        // Removed old auto-load for monitor-printing
        // User must now click "Load Trips" button manually
    });
});



// ========================================
// 🔧 DATE SANITIZATION FUNCTION
// ========================================

/**
 * Sanitize date string to be safe for file system paths
 * Converts: "2025-11-04 10:30:45" -> "2025-11-04"
 * Converts: "11/04/2025 10:30 AM" -> "2025-11-04"
 */
function sanitizeDateForPath(dateStr) {
    if (!dateStr) return 'unknown';
    
    try {
        // Try to parse as Date
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            // Format as YYYY-MM-DD (safe for paths)
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
    } catch (e) {
        console.warn('[JS] ⚠️ Could not parse date:', dateStr);
    }
    
    // Fallback: extract just the date part if it's already formatted
    const dateMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
        return dateMatch[1];
    }
    
    // Last resort: replace invalid characters
    return String(dateStr).split(' ')[0].replace(/[/:]/g, '-').substring(0, 10);
}

// ========================================
// AUTO-PRINT FUNCTIONS
// ========================================

window.handleAutoPrintToggle = function(tripId, tripDate, enabled, orderCount) {
    console.log('[JS] ⭐ handleAutoPrintToggle:', { tripId, tripDate, enabled });

    // 🔧 FIX: Sanitize tripDate immediately
    const safeTripDate = sanitizeDateForPath(tripDate);
    console.log('[JS] 🔧 Sanitized tripDate:', tripDate, '->', safeTripDate);

    const statusDiv = document.getElementById(`status_${tripId}_${tripDate}`);

    if (enabled) {
        const data = window.currentFullData || [];
        console.log('[JS] currentFullData length:', data.length);

        if (data.length === 0) {
            alert('No trip data loaded. Please click "Fetch Trips" first.');
            document.getElementById(`autoPrint_${tripId}_${tripDate}`).checked = false;
            return;
        }

        // Use the SAME filtering logic as openTripDetails (trip_id only, no date filter)
        const orders = data.filter(t => {
            const tripIdLower = (t.trip_id || '').toString().toLowerCase();
            const tripIdUpper = (t.TRIP_ID || '').toString().toLowerCase();
            const searchId = tripId.toString().toLowerCase();
            return tripIdLower === searchId || tripIdUpper === searchId;
        }).map(order => {
            // 🔧 FIX: Sanitize orderDate as well
            const rawOrderDate = order.ORDER_DATE || order.order_date || tripDate;
            const safeOrderDate = sanitizeDateForPath(rawOrderDate);

            return {
                orderNumber: order.ORDER_NUMBER || order.order_number,
                customerName: order.account_name || order.ACCOUNT_NAME || 'Unknown',
                accountNumber: order.ACCOUNT_NUMBER || order.account_number || '',
                orderDate: safeOrderDate,  // 🔧 Now safe for paths
                tripId: tripId,
                tripDate: safeTripDate     // 🔧 Now safe for paths
            };
        });

        console.log('[JS] ✅ Found', orders.length, 'orders for trip:', tripId);

        if (orders.length === 0) {
            alert('No orders found for this trip!\n\nTrip ID: ' + tripId + '\nPlease check the console for details.');
            console.error('[JS] Available trip IDs:', [...new Set(data.map(o => o.trip_id || o.TRIP_ID))].slice(0, 10));
            document.getElementById(`autoPrint_${tripId}_${tripDate}`).checked = false;
            return;
        }

        // Show printer selection modal instead of directly enabling
        if (typeof showPrinterSelectionModal === 'function') {
            showPrinterSelectionModal(tripId, safeTripDate, orders.length, orders);
        } else {
            console.error('[JS] showPrinterSelectionModal function not found!');
            alert('Error: Printer selection not available. Please refresh the page.');
            document.getElementById(`autoPrint_${tripId}_${tripDate}`).checked = false;
        }
    } else {
        // Disable auto-print
        if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.style.background = '#f3f4f6';
            statusDiv.style.borderLeft = '3px solid #9ca3af';
            statusDiv.innerHTML = '⏸️ Auto-print disabled';

            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 2000);
        }
    }
};

function toggleAutoPrint(tripId, tripDate, enabled, orders) {
    console.log('[JS] toggleAutoPrint:', { tripId, tripDate, enabled, ordersCount: orders?.length });
    
    const message = {
        action: enabled ? 'enableAutoPrint' : 'disableAutoPrint',
        tripId: tripId,
        tripDate: tripDate,
        enabled: enabled,
        orders: orders || []
    };
    
    sendMessageToCSharp(message, function(error, response) {
        console.log('[JS] Response received:', { error, response });
        
        const statusDiv = document.getElementById(`status_${tripId}_${tripDate}`);
        const toggleCheckbox = document.getElementById(`autoPrint_${tripId}_${tripDate}`);
        
        if (error) {
            console.error('[JS] ❌ Error:', error);
            if (statusDiv) {
                statusDiv.style.background = '#fee2e2';
                statusDiv.style.borderLeft = '3px solid #dc3545';
                statusDiv.innerHTML = '❌ Error: ' + error;
            }
            if (toggleCheckbox) toggleCheckbox.checked = !enabled;
            return;
        }
        
        console.log('[JS] ✅ Success');
        
        if (enabled) {
            if (statusDiv) {
                statusDiv.style.background = '#d4edda';
                statusDiv.style.borderLeft = '3px solid #28a745';
                statusDiv.innerHTML = `✅ Enabled for ${orders.length} orders`;
            }

            // Removed auto-refresh of monitor printing
            // User must manually click "Load Trips" to refresh
        } else {
            if (statusDiv) {
                statusDiv.style.display = 'none';
            }
        }
    });
}

function loadAutoPrintStatuses() {
    console.log('[JS] 🔄 Loading auto-print statuses...');
    
    sendMessageToCSharp({
        action: 'getPrintJobs',
        tripId: '',
        startDate: '',
        endDate: ''
    }, function(error, response) {
        if (error) {
            console.error('[JS] ❌ Error loading statuses:', error);
            return;
        }
        
        console.log('[JS] ✅ Statuses loaded:', response);
        
        if (response && response.data && response.data.jobs) {
            const tripStatuses = {};
            
            response.data.jobs.forEach(job => {
                const key = `${job.tripId}_${job.tripDate}`;
                if (!tripStatuses[key]) {
                    tripStatuses[key] = { totalJobs: 0, completed: 0, failed: 0, pending: 0 };
                }
                tripStatuses[key].totalJobs++;
                
                if (job.printStatus === 'Printed') {
                    tripStatuses[key].completed++;
                } else if (job.printStatus === 'Failed' || job.downloadStatus === 'Failed') {
                    tripStatuses[key].failed++;
                } else {
                    tripStatuses[key].pending++;
                }
            });
            
            console.log('[JS] Trip statuses:', tripStatuses);
            
            document.querySelectorAll('.auto-print-toggle').forEach(toggle => {
                const tripId = toggle.dataset.tripId;
                const tripDate = toggle.dataset.tripDate;
                const key = `${tripId}_${tripDate}`;
                
                if (tripStatuses[key] && tripStatuses[key].totalJobs > 0) {
                    toggle.checked = true;
                    updateAutoPrintStatus(tripId, tripDate, tripStatuses[key]);
                }
            });
        }
    });
}

function updateAutoPrintStatus(tripId, tripDate, status) {
    const statusDiv = document.getElementById(`status_${tripId}_${tripDate}`);
    if (!statusDiv) return;
    
    statusDiv.style.display = 'block';
    
    const completed = status.completed || 0;
    const failed = status.failed || 0;
    const pending = status.pending || 0;
    const total = status.totalJobs || 0;
    
    if (completed === total) {
        statusDiv.style.background = '#d4edda';
        statusDiv.style.borderLeft = '3px solid #28a745';
        statusDiv.innerHTML = `✅ All ${total} printed`;
    } else if (failed > 0) {
        statusDiv.style.background = '#f8d7da';
        statusDiv.style.borderLeft = '3px solid #dc3545';
        statusDiv.innerHTML = `⚠️ ${completed}/${total} | Failed: ${failed}`;
    } else {
        statusDiv.style.background = '#fff3cd';
        statusDiv.style.borderLeft = '3px solid #ffc107';
        statusDiv.innerHTML = `🔄 ${completed}/${total} | Pending: ${pending}`;
    }
}

// ========================================
// PRINT MANAGEMENT FUNCTIONS
// ========================================

// OLD FUNCTION - COMMENTED OUT - Now using APEX REST API in monitor-printing.js
/*
window.loadPrintJobs = function() {
    console.log('[JS] 🔄 Loading print jobs...');

    sendMessageToCSharp({
        action: 'getPrintJobs',
        tripId: '',
        startDate: '',
        endDate: ''
    }, function(error, response) {
        if (error) {
            console.error('[JS] ❌ Failed to load jobs:', error);
            return;
        }

        console.log('[JS] ✅ Jobs loaded:', response);
        console.log('[JS] 📋 Raw jobs data:', response?.data?.jobs);

        if (response && response.data) {
            const stats = response.data.stats || {};
            document.getElementById('stat-total-jobs').textContent = stats.totalJobs || 0;
            document.getElementById('stat-pending-download').textContent = stats.pendingDownload || 0;
            document.getElementById('stat-completed-download').textContent = stats.downloadCompleted || 0;
            document.getElementById('stat-pending-print').textContent = stats.pendingPrint || 0;
            document.getElementById('stat-printed').textContent = stats.printed || 0;
            document.getElementById('stat-failed').textContent = (stats.downloadFailed || 0) + (stats.printFailed || 0);

            // 🔧 FIX: Map C# field names to JavaScript grid column names
            const jobs = (response.data.jobs || []).map(job => {
                console.log('[JS] 🔍 Original job:', job);

                const mappedJob = {
                    // Try both PascalCase and camelCase field names
                    orderNumber: job.orderNumber || job.OrderNumber || job.ORDER_NUMBER || '',
                    accountNumber: job.accountNumber || job.AccountNumber || job.ACCOUNT_NUMBER || '',
                    customerName: job.customerName || job.CustomerName || job.CUSTOMER_NAME || 'Unknown',
                    tripId: job.tripId || job.TripId || job.TRIP_ID || '',
                    tripDate: job.tripDate || job.TripDate || job.TRIP_DATE || '',
                    downloadStatus: job.downloadStatus || job.DownloadStatus || job.DOWNLOAD_STATUS || 'Pending',
                    printStatus: job.printStatus || job.PrintStatus || job.PRINT_STATUS || 'Pending',
                    pdfPath: job.pdfPath || job.PdfPath || job.PDF_PATH || ''
                };

                console.log('[JS] ✅ Mapped job:', mappedJob);
                return mappedJob;
            });

            console.log('[JS] 📊 Total mapped jobs:', jobs.length);

            const gridInstance = $('#print-jobs-grid').dxDataGrid('instance');
            if (gridInstance) {
                gridInstance.option('dataSource', jobs);
                console.log('[JS] ✅ Grid updated with', jobs.length, 'jobs');
            }
        }
    });
};
*/

window.downloadOrderPdf = function(job) {
    console.log('[JS] 📥 Downloading PDF:', job.orderNumber);
    
    sendMessageToCSharp({
        action: 'downloadOrderPdf',
        orderNumber: job.orderNumber,
        tripId: job.tripId,
        tripDate: job.tripDate
    }, function(error, response) {
        if (error) {
            alert('Download failed: ' + error);
            return;
        }
        alert('✓ PDF downloaded successfully!');
        // OLD: loadPrintJobs(); - Now uses APEX REST API
        if (typeof loadMonitoringTrips === 'function') {
            loadMonitoringTrips();
        }
    });
};

window.printOrder = function(job) {
    console.log('[JS] 🖨️ Printing:', job.orderNumber);
    
    sendMessageToCSharp({
        action: 'printOrder',
        orderNumber: job.orderNumber,
        tripId: job.tripId,
        tripDate: job.tripDate
    }, function(error, response) {
        if (error) {
            alert('Print failed: ' + error);
            return;
        }
        alert('✓ Print job sent!');
        // OLD: loadPrintJobs(); - Now uses APEX REST API
        if (typeof loadMonitoringTrips === 'function') {
            loadMonitoringTrips();
        }
    });
};

window.viewPdf = function(pdfPath) {
    if (pdfPath) {
        window.open('file:///' + pdfPath.replace(/\\/g, '/'), '_blank');
    }
};

window.retryAllFailedJobs = function() {
    console.log('[JS] 🔄 Retrying failed jobs...');
    alert('This feature will retry all failed jobs.\n\nImplementation coming soon!');
};

window.testSelectedPrinter = function() {
    const printerName = document.getElementById('printer-select').value;
    if (!printerName) {
        alert('Please select a printer first');
        return;
    }
    
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
};

window.savePrinterConfiguration = function() {
    const config = {
        printerName: document.getElementById('printer-select').value,
        fusionInstance: document.getElementById('fusion-instance').value,
        fusionUsername: document.getElementById('fusion-username').value,
        fusionPassword: document.getElementById('fusion-password').value,
        autoDownload: document.getElementById('auto-download-checkbox').checked,
        autoPrint: document.getElementById('auto-print-checkbox').checked
    };
    
    if (!config.printerName) {
        alert('Please select a printer');
        return;
    }
    
    sendMessageToCSharp({
        action: 'configurePrinter',
        config: config
    }, function(error, response) {
        if (error) {
            alert('Failed to save configuration: ' + error);
            return;
        }
        alert('✓ Printer configuration saved successfully!');
    });
};

window.loadPrinterConfiguration = function() {
    sendMessageToCSharp({
        action: 'getPrinterConfig'
    }, function(error, response) {
        if (error) {
            console.error('[Print] Failed to load config:', error);
            return;
        }
        
        document.getElementById('printer-select').value = response.printerName || '';
        document.getElementById('fusion-instance').value = response.fusionInstance || 'TEST';
        document.getElementById('fusion-username').value = response.fusionUsername || '';
        document.getElementById('fusion-password').value = response.fusionPassword || '';
        document.getElementById('auto-download-checkbox').checked = response.autoDownload !== false;
        document.getElementById('auto-print-checkbox').checked = response.autoPrint !== false;
        
        console.log('[Print] Configuration loaded');
    });
};

function loadInstalledPrinters() {
    sendMessageToCSharp({
        action: 'getInstalledPrinters'
    }, function(error, response) {
        if (error) {
            console.error('[Print] Failed to load printers:', error);
            return;
        }
        
        const printerSelect = document.getElementById('printer-select');
        printerSelect.innerHTML = '<option value="">Select a printer...</option>';
        
        response.printers.forEach(printer => {
            const option = document.createElement('option');
            option.value = printer;
            option.textContent = printer;
            if (printer === response.defaultPrinter) {
                option.textContent += ' (Default)';
            }
            printerSelect.appendChild(option);
        });
        
        console.log(`[Print] Loaded ${response.printers.length} printers`);
    });
}

function initPrintJobsGrid() {
    $('#print-jobs-grid').dxDataGrid({
        dataSource: [],
        columns: [
            { dataField: 'orderNumber', caption: 'Order Number', width: 150 },
            { dataField: 'accountNumber', caption: 'Account Number', width: 130 },
            { dataField: 'customerName', caption: 'Customer Name', width: 200 },
            { dataField: 'tripId', caption: 'Trip ID', width: 120 },
            { dataField: 'tripDate', caption: 'Trip Date', width: 120, dataType: 'date' },
            { 
                dataField: 'downloadStatus', 
                caption: 'Download Status', 
                width: 150,
                cellTemplate: function(container, options) {
                    const status = options.value || 'Pending';
                    const statusClass = `status-${status.toLowerCase()}`;
                    container.append($('<span>').addClass(`status-badge ${statusClass}`).text(status));
                }
            },
            { 
                dataField: 'printStatus', 
                caption: 'Print Status', 
                width: 150,
                cellTemplate: function(container, options) {
                    const status = options.value || 'Pending';
                    const statusClass = `status-${status.toLowerCase()}`;
                    container.append($('<span>').addClass(`status-badge ${statusClass}`).text(status));
                }
            },
            {
                caption: 'Actions',
                width: 250,
                cellTemplate: function(container, options) {
                    const row = options.data;
                    const actionGroup = $('<div>').addClass('action-btn-group');
                    
                    if (row.downloadStatus !== 'Completed') {
                        actionGroup.append(
                            $('<button>')
                                .addClass('action-btn action-btn-primary')
                                .html('<i class="fas fa-download"></i> Download')
                                .on('click', () => downloadOrderPdf(row))
                        );
                    }
                    
                    if (row.downloadStatus === 'Completed' && row.printStatus !== 'Printed') {
                        actionGroup.append(
                            $('<button>')
                                .addClass('action-btn action-btn-primary')
                                .html('<i class="fas fa-print"></i> Print')
                                .on('click', () => printOrder(row))
                        );
                    }
                    
                    if (row.pdfPath) {
                        actionGroup.append(
                            $('<button>')
                                .addClass('action-btn action-btn-secondary')
                                .html('<i class="fas fa-file-pdf"></i> View')
                                .on('click', () => viewPdf(row.pdfPath))
                        );
                    }
                    
                    container.append(actionGroup);
                }
            }
        ],
        showBorders: true,
        showRowLines: true,
        rowAlternationEnabled: true,
        columnAutoWidth: true,
        paging: { pageSize: 20 },
        pager: {
            visible: true,
            allowedPageSizes: [10, 20, 50, 100],
            showPageSizeSelector: true
        },
        filterRow: { visible: true },
        headerFilter: { visible: true },
        export: { enabled: true, fileName: 'print-jobs' }
    });
}

// ========================================
// MESSAGE LISTENER SETUP
// ========================================

if (window.chrome?.webview) {
    console.log('[JS] 🔧 Setting up message listener...');
    
    window.chrome.webview.addEventListener('message', function(event) {
        console.log('[JS] 📨 Message from C#:', event.data);
        
        const response = event.data;
        
        if (window.pendingRequests && window.pendingRequests[response.requestId]) {
            const callback = window.pendingRequests[response.requestId];
            delete window.pendingRequests[response.requestId];
            
            if (response.action === "autoPrintResponse") {
                callback(response.success ? null : response.message, response);
            } else if (response.action === "printJobsResponse") {
                callback(null, response);
            } else if (response.action === "error") {
                callback(response.message || response.data?.message, null);
            } else if (response.action === "restResponse") {
                callback(null, response.data);
            } else {
                callback(null, response.data || response);
            }
        } else {
            console.warn('[JS] ⚠️ No callback found for requestId:', response.requestId);
        }
    });
    
    console.log('[JS] ✅ Message listener ready');
} else {
    console.warn('[JS] ⚠️ WebView2 not available');
}

// ========================================
// DOM CONTENT LOADED
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('[JS] 📄 DOM Content Loaded');

    // Initialize instance selector
    initializeInstance();

    // Collapse/Expand Parameters
    document.getElementById('parameters-toggle').addEventListener('click', function() {
        const content = document.getElementById('parameters-content');
        const icon = document.getElementById('collapse-icon');
        content.classList.toggle('collapsed');
        icon.classList.toggle('collapsed');
    });

    // Hamburger menu
    document.getElementById('hamburger').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('collapsed');
    });

    // Menu navigation
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', function() {
            document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.page-content').forEach(page => page.style.display = 'none');
            const pageId = this.getAttribute('data-page');
            document.getElementById(pageId).style.display = 'block';
            
            const pageTitle = this.textContent.trim();
            document.title = `WMS - ${pageTitle}`;
            
            if (pageId === 'vehicles' && currentFullData.length > 0) {
                initVehiclesPage();
            } else if (pageId === 'monitor-printing') {
                // ✅ Restore grid data if available (don't refresh unless user clicks Fetch Trips)
                if (typeof restoreMonitoringGridIfNeeded === 'function') {
                    restoreMonitoringGridIfNeeded();
                }
            } else if (pageId === 'printer-setup') {
                loadInstalledPrinters();
                loadPrinterConfiguration();
            }
        });
    });

    // Set default dates
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    document.getElementById('trip-date-from').valueAsDate = yesterday;
    document.getElementById('trip-date-to').valueAsDate = tomorrow;

    // Fetch Trips button
    document.getElementById('fetch-trips-btn').addEventListener('click', function() {
        const instanceName = document.getElementById('trip-instance-name').value;
        const dateFrom = document.getElementById('trip-date-from').value;
        const dateTo = document.getElementById('trip-date-to').value;

        if (!dateFrom || !dateTo) {
            alert('Please select both From Date and To Date');
            return;
        }
        if (new Date(dateFrom) > new Date(dateTo)) {
            alert('From Date cannot be after To Date');
            return;
        }

        const fetchBtn = document.getElementById('fetch-trips-btn');
        const fetchIcon = document.getElementById('fetch-icon');
        const fetchText = document.getElementById('fetch-text');
        fetchBtn.disabled = true;
        fetchIcon.className = '';
        fetchIcon.innerHTML = '<span class="spinner"></span>';
        fetchText.textContent = 'Processing...';

        const formatDate = (dateStr) => {
            const d = new Date(dateStr);
            return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
        };

        const baseUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/GETTRIPDETAILS';
        const params = new URLSearchParams({
            P_DATE_FROM: formatDate(dateFrom),
            P_DATE_TO: formatDate(dateTo),
            P_INSTANCE_NAME: instanceName
        });
        const fullUrl = `${baseUrl}?${params.toString()}`;

        currentParams = {
            fromDate: formatDate(dateFrom),
            toDate: formatDate(dateTo),
            instance: instanceName
        };

        const gridContainer = document.getElementById('trips-grid');
        gridContainer.innerHTML = '<div style="padding:2rem;text-align:center;"><div class="spinner" style="width:40px;height:40px;margin:0 auto 1rem;border:3px solid rgba(99,102,241,0.3);border-top-color:#6366f1;border-radius:50%;animation:spin 0.8s linear infinite;"></div><p>Loading trips data...</p></div>';

        sendMessageToCSharp({
            action: "executeGet",
            fullUrl: fullUrl
        }, function(error, data) {
            fetchBtn.disabled = false;
            fetchIcon.innerHTML = '';
            fetchIcon.className = 'fas fa-sync-alt';
            fetchText.textContent = 'Fetch Trips';

            if (error) {
                gridContainer.innerHTML = `
                    <div style="padding:2rem;text-align:center;">
                        <i class="fas fa-exclamation-triangle" style="font-size:3rem;color:#ef4444;margin-bottom:1rem;"></i>
                        <h3 style="color:#ef4444;">Error</h3>
                        <p style="color:#64748b;">${error}</p>
                    </div>
                `;
            } else {
                try {
                    let trips = JSON.parse(data);
                    if (!Array.isArray(trips) && trips?.items) trips = trips.items;
                    if (!Array.isArray(trips)) trips = [];
                    displayTripData(trips);
                    currentFullData = trips;
                    window.currentFullData = trips;
                } catch (e) {
                    gridContainer.innerHTML = `<div style="padding:2rem;color:#e53e3e;">Invalid JSON: ${e.message}</div>`;
                }
            }
        });
    });

    function displayTripData(trips) {
        const gridContainer = document.getElementById('trips-grid');
        const tripCount = document.getElementById('trip-count');
        const summaryStats = document.getElementById('summary-stats');

        if (!trips || trips.length === 0) {
            gridContainer.innerHTML = `<div style="padding:3rem;text-align:center;color:#64748b;">
                <i class="fas fa-truck" style="font-size:3rem;margin-bottom:1.5rem;color:#cbd5e1;"></i>
                <h3>No Trips Found</h3>
            </div>`;
            tripCount.textContent = '0 trips';
            summaryStats.style.display = 'none';
            return;
        }

        const totalOrders = trips.length;
        const customers = new Set(trips.map(t => t.account_name).filter(x => x)).size;
        const lorries = new Set(trips.map(t => t.trip_lorry).filter(x => x)).size;
        const pickers = new Set(trips.map(t => t.PICKER).filter(x => x)).size;
        const distinctTrips = new Set(trips.map(t => t.trip_id).filter(x => x)).size;

        summaryStats.innerHTML = `
            <div class="stat-card" style="cursor: pointer;" onclick="openTripManagementTab('orders')">
                <div class="value">${totalOrders}</div>
                <div class="label">Total Orders</div>
            </div>
            <div class="stat-card" style="cursor: pointer;" onclick="openTripManagementTab('customers')">
                <div class="value">${customers}</div>
                <div class="label">Total Customers</div>
            </div>
            <div class="stat-card" style="cursor: pointer;" onclick="openTripManagementTab('lorries')">
                <div class="value">${lorries}</div>
                <div class="label">Total Lorries</div>
            </div>
            <div class="stat-card" style="cursor: pointer;" onclick="openTripManagementTab('pickers')">
                <div class="value">${pickers}</div>
                <div class="label">Total Pickers</div>
            </div>
            <div class="stat-card" style="cursor: pointer;" onclick="openTripManagementTab('trips')">
                <div class="value">${distinctTrips}</div>
                <div class="label">Total Trips</div>
            </div>
        `;
        summaryStats.style.display = 'grid';

        // Auto-populate Trips tab
        openTripManagementTab('trips');

        setupAllTripsFilters(trips);
        
        const first = trips[0];
        const columns = Object.keys(first).map(key => {
            let col = { dataField: key, caption: key.replace(/_/g, ' ') };
            if (key === 'LINE_STATUS') {
                col.cellTemplate = (container, options) => {
                    const val = options.value || 'Unknown';
                    const safeClass = String(val).toLowerCase()
                        .replace(/,/g, ' ')
                        .replace(/\s+/g, '-')
                        .replace(/[^a-z0-9-]/g, '')
                        .replace(/-+/g, '-')
                        .replace(/^-|-$/g, '') || 'unknown';
                    $(container).html(`<span class="status-badge status-${safeClass}">${val}</span>`);
                };
            } else if (key.endsWith('_WEIGHT')) {
                col.format = { type: 'fixedPoint', precision: 2 };
                col.alignment = 'right';
            } else if (key.endsWith('_ITEMS') || !isNaN(Number(first[key]))) {
                col.format = { type: 'fixedPoint', precision: 0 };
                col.alignment = 'right';
            }
            return col;
        });

        try {
            const existingGrid = $(gridContainer).dxDataGrid('instance');
            if (existingGrid) {
                existingGrid.dispose();
            }
        } catch (e) {}
        $(gridContainer).empty();

        $(gridContainer).dxDataGrid({
            dataSource: trips,
            columns: columns,
            showBorders: true,
            columnAutoWidth: true,
            scrolling: { useNative: true, showScrollbar: 'always' },
            filterRow: { visible: true },
            headerFilter: { visible: true },
            groupPanel: { visible: true },
            searchPanel: { visible: true, placeholder: "Search..." },
            paging: { pageSize: 20 },
            pager: { showPageSizeSelector: true, allowedPageSizes: [10, 20, 50, 'all'] },
            allowColumnReordering: true,
            allowColumnResizing: true,
            columnResizingMode: 'widget',
            rowAlternationEnabled: true,
            selection: {
                mode: 'multiple',
                showCheckBoxesMode: 'always'
            },
            export: {
                enabled: true,
                allowExportSelectedData: true
            },
            height: '100%'
        });

        tripCount.textContent = `${trips.length} ${trips.length === 1 ? 'trip' : 'trips'}`;
    }

    function setupMultiSelectDropdown(buttonId, contentId, textId, defaultText) {
        const dropdown = document.getElementById(buttonId);
        const button = dropdown.querySelector('.multi-select-button');
        const content = document.getElementById(contentId);
        
        button.addEventListener('click', function(e) {
            e.stopPropagation();
            document.querySelectorAll('.multi-select-dropdown-content').forEach(d => {
                if (d !== content) d.classList.remove('show');
            });
            content.classList.toggle('show');
        });
        
        content.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        
        document.addEventListener('click', function() {
            content.classList.remove('show');
        });
    }

    function updateAllCheckbox(allCheckboxId, itemCheckboxesSelector) {
        const allCheckbox = document.getElementById(allCheckboxId);
        const itemCheckboxes = document.querySelectorAll(itemCheckboxesSelector);
        const allChecked = Array.from(itemCheckboxes).every(cb => cb.checked);
        allCheckbox.checked = allChecked;
    }

    function updateFilterText(textElementId, checkboxes, defaultText) {
        const textElement = document.getElementById(textElementId);
        const checkedItems = Array.from(checkboxes).filter(cb => cb.checked);
        
        if (checkedItems.length === 0) {
            textElement.textContent = 'None selected';
        } else if (checkedItems.length === checkboxes.length) {
            textElement.textContent = defaultText;
        } else if (checkedItems.length <= 3) {
            textElement.textContent = checkedItems.map(cb => cb.value).join(', ');
        } else {
            textElement.textContent = `${checkedItems.length} selected`;
        }
    }

    function applyAllTripsFilters() {
        const selectedLorries = Array.from(document.querySelectorAll('.lorry-checkbox:checked')).map(cb => cb.value);
        const selectedDates = Array.from(document.querySelectorAll('.date-checkbox:checked')).map(cb => cb.value);
        
        let filteredData = currentFullData;
        
        if (selectedLorries.length > 0 && selectedLorries.length < document.querySelectorAll('.lorry-checkbox').length) {
            filteredData = filteredData.filter(trip => selectedLorries.includes(trip.trip_lorry));
        }
        
        if (selectedDates.length > 0 && selectedDates.length < document.querySelectorAll('.date-checkbox').length) {
            filteredData = filteredData.filter(trip => {
                let tripDate = null;
                for (let key in trip) {
                    const lowerKey = key.toLowerCase();
                    if (lowerKey === 'order_date' || lowerKey === 'orderdate' || 
                        lowerKey === 'shipment_date' || lowerKey === 'shipmentdate' ||
                        lowerKey === 'trip_date' || lowerKey === 'tripdate') {
                        tripDate = trip[key];
                        break;
                    }
                }
                if (tripDate) {
                    const dateKey = String(tripDate).split(' ')[0];
                    return selectedDates.includes(dateKey);
                }
                return false;
            });
        }
        
        const gridInstance = $('#trips-grid').dxDataGrid('instance');
        if (gridInstance) {
            gridInstance.option('dataSource', filteredData);
        }
        
        document.getElementById('trip-count').textContent = 
            `${filteredData.length} ${filteredData.length === 1 ? 'trip' : 'trips'}`;
    }

    function setupAllTripsFilters(trips) {
        const lorrySet = new Set(trips.map(t => t.trip_lorry).filter(x => x));
        const lorries = Array.from(lorrySet).sort();
        
        const dateSet = new Set();
        trips.forEach(trip => {
            let date = null;
            for (let key in trip) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'order_date' || lowerKey === 'orderdate' || 
                    lowerKey === 'shipment_date' || lowerKey === 'shipmentdate' ||
                    lowerKey === 'trip_date' || lowerKey === 'tripdate') {
                    date = trip[key];
                    break;
                }
            }
            if (date) {
                const dateKey = String(date).split(' ')[0];
                if (dateKey) dateSet.add(dateKey);
            }
        });
        const dates = Array.from(dateSet).sort();
        
        const lorryContent = document.getElementById('lorry-filter-content');
        let lorryHTML = `
            <div class="multi-select-option all-option">
                <input type="checkbox" id="all-lorries" checked>
                <label for="all-lorries" style="cursor: pointer; margin: 0;">All Lorries</label>
            </div>
        `;
        lorries.forEach((lorry, index) => {
            lorryHTML += `
                <div class="multi-select-option">
                    <input type="checkbox" id="lorry-${index}" value="${lorry}" class="lorry-checkbox" checked>
                    <label for="lorry-${index}" style="cursor: pointer; margin: 0;">${lorry}</label>
                </div>
            `;
        });
        lorryContent.innerHTML = lorryHTML;
        
        const dateContent = document.getElementById('date-filter-content');
        let dateHTML = `
            <div class="multi-select-option all-option">
                <input type="checkbox" id="all-dates" checked>
                <label for="all-dates" style="cursor: pointer; margin: 0;">All Dates</label>
            </div>
        `;
        dates.forEach((date, index) => {
            dateHTML += `
                <div class="multi-select-option">
                    <input type="checkbox" id="date-${index}" value="${date}" class="date-checkbox" checked>
                    <label for="date-${index}" style="cursor: pointer; margin: 0;">${date}</label>
                </div>
            `;
        });
        dateContent.innerHTML = dateHTML;
        
        setupMultiSelectDropdown('lorry-filter-dropdown', 'lorry-filter-content', 'lorry-filter-text', 'All Lorries');
        setupMultiSelectDropdown('date-filter-dropdown', 'date-filter-content', 'date-filter-text', 'All Dates');
        
        document.getElementById('all-lorries').addEventListener('change', function() {
            const lorryCheckboxes = document.querySelectorAll('.lorry-checkbox');
            lorryCheckboxes.forEach(cb => cb.checked = this.checked);
            updateFilterText('lorry-filter-text', lorryCheckboxes, 'All Lorries');
            applyAllTripsFilters();
        });
        
        document.getElementById('all-dates').addEventListener('change', function() {
            const dateCheckboxes = document.querySelectorAll('.date-checkbox');
            dateCheckboxes.forEach(cb => cb.checked = this.checked);
            updateFilterText('date-filter-text', dateCheckboxes, 'All Dates');
            applyAllTripsFilters();
        });
        
        document.querySelectorAll('.lorry-checkbox').forEach(cb => {
            cb.addEventListener('change', function() {
                updateAllCheckbox('all-lorries', '.lorry-checkbox');
                updateFilterText('lorry-filter-text', document.querySelectorAll('.lorry-checkbox'), 'All Lorries');
                applyAllTripsFilters();
            });
        });
        
        document.querySelectorAll('.date-checkbox').forEach(cb => {
            cb.addEventListener('change', function() {
                updateAllCheckbox('all-dates', '.date-checkbox');
                updateFilterText('date-filter-text', document.querySelectorAll('.date-checkbox'), 'All Dates');
                applyAllTripsFilters();
            });
        });
        
        const clearBtn = document.getElementById('clear-all-filters-btn');
        if (clearBtn) {
            const newClearBtn = clearBtn.cloneNode(true);
            clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
            
            newClearBtn.addEventListener('click', function() {
                document.getElementById('all-lorries').checked = true;
                document.querySelectorAll('.lorry-checkbox').forEach(cb => cb.checked = true);
                updateFilterText('lorry-filter-text', document.querySelectorAll('.lorry-checkbox'), 'All Lorries');
                
                document.getElementById('all-dates').checked = true;
                document.querySelectorAll('.date-checkbox').forEach(cb => cb.checked = true);
                updateFilterText('date-filter-text', document.querySelectorAll('.date-checkbox'), 'All Dates');
                
                applyAllTripsFilters();
            });
        }
    }

    window.openTripManagementTab = function(tabType) {
        const tabHeader = document.getElementById('trip-tab-header');
        const tabContent = document.getElementById('trip-tab-content');
        
        const tabId = `trip-${tabType}`;
        const existingTab = document.querySelector(`.tab-item[data-tab="${tabId}"]`);
        if (existingTab) {
            activateTripTab(tabId);
            return;
        }
        
        let tabName = '';
        switch(tabType) {
            case 'orders': tabName = 'Orders'; break;
            case 'customers': tabName = 'Customers'; break;
            case 'lorries': tabName = 'Lorries'; break;
            case 'pickers': tabName = 'Pickers'; break;
            case 'trips': tabName = 'Trips'; break;
        }
        
        const tabItem = document.createElement('div');
        tabItem.className = 'tab-item';
        tabItem.dataset.tab = tabId;
        tabItem.innerHTML = `
            <span>${tabName}</span>
            <span class="close-tab" onclick="closeTripTab('${tabId}', event)">&times;</span>
        `;
        tabItem.addEventListener('click', function(e) {
            if (!e.target.classList.contains('close-tab')) {
                activateTripTab(tabId);
            }
        });
        tabHeader.appendChild(tabItem);
        
        const tabPane = document.createElement('div');
        tabPane.className = 'tab-pane';
        tabPane.id = `trip-${tabId}-tab`;
        tabPane.innerHTML = `<div id="grid-${tabId}" style="height: 600px;"></div>`;
        tabContent.appendChild(tabPane);
        
        activateTripTab(tabId);
        
        setTimeout(() => {
            renderTripTabData(tabType, tabId);
        }, 100);
    };

    function renderTripTabData(tabType, tabId) {
        const gridId = `grid-${tabId}`;
        let aggregatedData = [];
        let columns = [];
        
        if (tabType === 'trips') {
            renderTripsAsCards(tabId);
            return;
        }
        
        switch(tabType) {
            case 'orders':
                const orderMap = {};
                currentFullData.forEach(trip => {
                    const orderNum = trip.ORDER_NUMBER || trip.order_number || 'Unknown';
                    if (!orderMap[orderNum]) {
                        orderMap[orderNum] = {
                            ORDER_DATE: trip.ORDER_DATE || trip.order_date || '',
                            ORDER_NUMBER: orderNum,
                            ACCOUNT_NUMBER: trip.ACCOUNT_NUMBER || trip.account_number || '',
                            ACCOUNT_NAME: trip.account_name || trip.ACCOUNT_NAME || '',
                            ORDER_TYPE: trip.ORDER_TYPE || trip.order_type || '',
                            TOTAL_LINES: 0
                        };
                    }
                    orderMap[orderNum].TOTAL_LINES++;
                });
                aggregatedData = Object.values(orderMap);
                columns = [
                    { dataField: 'ORDER_DATE', caption: 'Order Date' },
                    { dataField: 'ORDER_NUMBER', caption: 'Order Number' },
                    { dataField: 'ACCOUNT_NUMBER', caption: 'Account Number' },
                    { dataField: 'ACCOUNT_NAME', caption: 'Account Name' },
                    { dataField: 'ORDER_TYPE', caption: 'Order Type' },
                    { dataField: 'TOTAL_LINES', caption: 'Total Lines', alignment: 'right' }
                ];
                break;
                
            case 'customers':
                const customerMap = {};
                currentFullData.forEach(trip => {
                    const customer = trip.account_name || trip.ACCOUNT_NAME || 'Unknown';
                    if (!customerMap[customer]) {
                        customerMap[customer] = {
                            CUSTOMER_NAME: customer,
                            ORDER_COUNT: 0
                        };
                    }
                    customerMap[customer].ORDER_COUNT++;
                });
                aggregatedData = Object.values(customerMap);
                columns = [
                    { dataField: 'CUSTOMER_NAME', caption: 'Customer Name' },
                    { dataField: 'ORDER_COUNT', caption: 'Order Count', alignment: 'right' }
                ];
                break;
                
            case 'lorries':
                const lorryMap = {};
                currentFullData.forEach(trip => {
                    const lorry = trip.trip_lorry || trip.TRIP_LORRY || 'Unknown';
                    if (!lorryMap[lorry]) {
                        lorryMap[lorry] = {
                            LORRY_NAME: lorry,
                            TOTAL_ORDERS: 0,
                            customers: new Set()
                        };
                    }
                    lorryMap[lorry].TOTAL_ORDERS++;
                    const customer = trip.account_name || trip.ACCOUNT_NAME;
                    if (customer) {
                        lorryMap[lorry].customers.add(customer);
                    }
                });
                aggregatedData = Object.values(lorryMap).map(l => ({
                    LORRY_NAME: l.LORRY_NAME,
                    TOTAL_ORDERS: l.TOTAL_ORDERS,
                    TOTAL_CUSTOMERS: l.customers.size
                }));
                columns = [
                    { dataField: 'LORRY_NAME', caption: 'Lorry Name' },
                    { dataField: 'TOTAL_ORDERS', caption: 'Total Orders', alignment: 'right' },
                    { dataField: 'TOTAL_CUSTOMERS', caption: 'Total Customers', alignment: 'right' }
                ];
                break;
                
            case 'pickers':
                const pickerMap = {};
                currentFullData.forEach(trip => {
                    const picker = trip.PICKER || trip.picker || 'Unknown';
                    if (!pickerMap[picker]) {
                        pickerMap[picker] = {
                            PICKER_NAME: picker,
                            ORDER_COUNT: 0
                        };
                    }
                    pickerMap[picker].ORDER_COUNT++;
                });
                aggregatedData = Object.values(pickerMap);
                columns = [
                    { dataField: 'PICKER_NAME', caption: 'Picker Name' },
                    { dataField: 'ORDER_COUNT', caption: 'Order Count', alignment: 'right' }
                ];
                break;
        }
        
        const gridContainer = $(`#${gridId}`);
        try {
            const existingGrid = gridContainer.dxDataGrid('instance');
            if (existingGrid) {
                existingGrid.dispose();
            }
        } catch (e) {}
        gridContainer.empty();
        
        gridContainer.dxDataGrid({
            dataSource: aggregatedData,
            columns: columns,
            showBorders: true,
            columnAutoWidth: true,
            scrolling: { useNative: true, showScrollbar: 'always' },
            filterRow: { visible: true },
            headerFilter: { visible: true },
            searchPanel: { visible: true, placeholder: "Search..." },
            paging: { pageSize: 20 },
            pager: { showPageSizeSelector: true, allowedPageSizes: [10, 20, 50, 'all'] },
            allowColumnReordering: true,
            allowColumnResizing: true,
            columnResizingMode: 'widget',
            rowAlternationEnabled: true,
            selection: {
                mode: 'multiple',
                showCheckBoxesMode: 'always'
            },
            export: {
                enabled: true,
                allowExportSelectedData: true
            },
            height: '100%'
        });
    }

    function renderTripsAsCards(tabId) {
        const tripMap = {};
        currentFullData.forEach(trip => {
            const tripId = trip.trip_id || trip.TRIP_ID || 'Unknown';
            if (!tripMap[tripId]) {
                let tripDate = null;
                for (let key in trip) {
                    const lowerKey = key.toLowerCase();
                    if (lowerKey === 'order_date' || lowerKey === 'orderdate' || 
                        lowerKey === 'shipment_date' || lowerKey === 'shipmentdate' ||
                        lowerKey === 'trip_date' || lowerKey === 'tripdate') {
                        tripDate = trip[key];
                        break;
                    }
                }
                
                tripMap[tripId] = {
                    TRIP_ID: tripId,
                    TRIP_DATE: tripDate ? String(tripDate).split(' ')[0] : 'N/A',
                    LORRY_NUMBER: trip.trip_lorry || trip.TRIP_LORRY || 'N/A',
                    PRIORITY: trip.TRIP_PRIORITY || trip.trip_priority || 'Medium',
                    STATUS: trip.TRIP_STATUS || trip.trip_status || trip.LINE_STATUS || 'ACTIVE',
                    INSTANCE: trip.INSTANCE || trip.instance || trip.instance_name || trip.INSTANCE_NAME || null,
                    TOTAL_ORDERS: 0,
                    orders: []
                };
            }
            tripMap[tripId].TOTAL_ORDERS++;
            tripMap[tripId].orders.push(trip);
        });
        
        let tripsArray = Object.values(tripMap);
        
        const priorityOrder = { 'High': 1, 'Medium': 2, 'Low': 3 };
        tripsArray.sort((a, b) => {
            if (a.TRIP_DATE !== b.TRIP_DATE) {
                return b.TRIP_DATE.localeCompare(a.TRIP_DATE);
            }
            const aPriority = priorityOrder[a.PRIORITY] || 2;
            const bPriority = priorityOrder[b.PRIORITY] || 2;
            return aPriority - bPriority;
        });
        
        const uniqueDates = [...new Set(tripsArray.map(t => t.TRIP_DATE))].sort().reverse();

        const container = document.getElementById(`grid-${tabId}`);
        container.style.height = 'auto';
        container.innerHTML = `
            <!-- Results Header with Date Filters -->
            <div style="background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 1rem; padding: 1.25rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                    <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                        <i class="fas fa-truck-loading" style="color: white; font-size: 1.1rem;"></i>
                    </div>
                    <div>
                        <div style="font-size: 1rem; font-weight: 700; color: #1e293b;">Trip Results</div>
                        <div style="font-size: 0.75rem; color: #64748b;">Showing <span id="trips-count-${tabId}" style="font-weight: 700; color: #667eea;">${tripsArray.length}</span> of ${tripsArray.length} trips</div>
                    </div>
                </div>

                <div style="border-top: 1px solid #e2e8f0; padding-top: 1rem;">
                    <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
                        <div style="color: #64748b; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fas fa-calendar-alt" style="color: #667eea;"></i>
                            Filter by Date:
                        </div>
                        <div id="date-filters-${tabId}" style="display: flex; flex-wrap: wrap; gap: 0.5rem; flex: 1;">
                            ${uniqueDates.map(date =>
                                `<span class="filter-chip active" data-date="${date}" data-tab="${tabId}">${date}</span>`
                            ).join('')}
                        </div>
                        <button class="btn btn-secondary" id="select-all-dates-${tabId}" style="white-space: nowrap; font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                            <i class="fas fa-check-double"></i> Select All
                        </button>
                        <button class="btn btn-secondary" id="clear-all-dates-${tabId}" style="white-space: nowrap; font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                            <i class="fas fa-times"></i> Clear All
                        </button>
                    </div>
                </div>
            </div>

            <!-- Trip Cards Container -->
            <div id="trip-cards-${tabId}" class="trip-cards-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem; padding: 0 0.5rem;"></div>
        `;
        
        setTimeout(() => {
            document.querySelectorAll(`#date-filters-${tabId} .filter-chip`).forEach(chip => {
                chip.addEventListener('click', function() {
                    this.classList.toggle('active');
                    
                    const selectedDates = Array.from(document.querySelectorAll(`#date-filters-${tabId} .filter-chip.active`))
                        .map(c => c.dataset.date);
                    
                    renderTripCards(tabId, tripsArray, selectedDates.length > 0 ? selectedDates : null);
                });
            });
            
            document.getElementById(`select-all-dates-${tabId}`).addEventListener('click', function() {
                document.querySelectorAll(`#date-filters-${tabId} .filter-chip`).forEach(chip => {
                    chip.classList.add('active');
                });
                renderTripCards(tabId, tripsArray, null);
            });
            
            document.getElementById(`clear-all-dates-${tabId}`).addEventListener('click', function() {
                document.querySelectorAll(`#date-filters-${tabId} .filter-chip`).forEach(chip => {
                    chip.classList.remove('active');
                });
                renderTripCards(tabId, tripsArray, []);
            });
        }, 50);
        
        renderTripCards(tabId, tripsArray, null);
    }

    function renderTripCards(tabId, trips, filterDates) {
        const container = document.getElementById(`trip-cards-${tabId}`);
        
        let filteredTrips = trips;
        
        if (filterDates && filterDates.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-truck"></i><h3>No dates selected</h3><p>Please select at least one date to view trips</p></div>';
            document.getElementById(`trips-count-${tabId}`).textContent = '0';
            return;
        }
        
        if (filterDates && filterDates.length > 0) {
            filteredTrips = trips.filter(t => filterDates.includes(t.TRIP_DATE));
        }
        
        document.getElementById(`trips-count-${tabId}`).textContent = filteredTrips.length;
        
        if (filteredTrips.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-truck"></i><h3>No Trips Found</h3><p>No trips match the selected dates</p></div>';
            return;
        }
        
        let html = '';
        filteredTrips.forEach(trip => {
            const priorityColor = trip.PRIORITY.toLowerCase().includes('high') ? '#ef4444' :
                                 trip.PRIORITY.toLowerCase().includes('low') ? '#22c55e' : '#f59e0b';
            const priorityBg = trip.PRIORITY.toLowerCase().includes('high') ? 'linear-gradient(135deg, #ef4444, #dc2626)' :
                              trip.PRIORITY.toLowerCase().includes('low') ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'linear-gradient(135deg, #f59e0b, #d97706)';

            html += `
                <div style="background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; transition: all 0.2s ease; border-left: 3px solid ${priorityColor};" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 3px 8px rgba(0,0,0,0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(0,0,0,0.1)';">
                    <!-- Card Header -->
                    <div style="padding: 0.5rem 0.75rem; background: linear-gradient(to right, #f8f9fc, #ffffff); border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 5px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-route" style="color: white; font-size: 0.75rem;"></i>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 0.1rem;">
                                <span style="font-size: 0.9rem; font-weight: 700; color: #1e293b;">Trip #${trip.TRIP_ID}</span>
                                <span style="font-size: 0.65rem; font-weight: 600; color: #64748b; text-transform: uppercase;">${trip.STATUS || 'ACTIVE'}</span>
                            </div>
                        </div>
                        <div style="background: ${priorityBg}; color: white; padding: 0.25rem 0.6rem; border-radius: 10px; font-size: 0.6rem; font-weight: 600; text-transform: uppercase;">
                            ${trip.PRIORITY}
                        </div>
                    </div>

                    <!-- Card Body -->
                    <div style="padding: 0.75rem;">
                        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.6rem;">
                            <!-- Trip Date -->
                            <div style="flex: 1; padding: 0.5rem; background: #f0f9ff; border-radius: 5px; border-left: 2px solid #3b82f6;">
                                <div style="font-size: 0.6rem; font-weight: 600; color: #64748b; margin-bottom: 0.2rem; text-transform: uppercase; letter-spacing: 0.3px;">Date</div>
                                <div style="font-size: 0.75rem; font-weight: 700; color: #1e293b;">${trip.TRIP_DATE}</div>
                            </div>

                            <!-- Lorry Number -->
                            <div style="flex: 1; padding: 0.5rem; background: #f0fdf4; border-radius: 5px; border-left: 2px solid #10b981;">
                                <div style="font-size: 0.6rem; font-weight: 600; color: #64748b; margin-bottom: 0.2rem; text-transform: uppercase; letter-spacing: 0.3px;">Lorry</div>
                                <div style="font-size: 0.75rem; font-weight: 700; color: #1e293b;">${trip.LORRY_NUMBER}</div>
                            </div>

                            <!-- Total Orders -->
                            <div style="flex: 1; padding: 0.5rem; background: #fff7ed; border-radius: 5px; border-left: 2px solid #f59e0b;">
                                <div style="font-size: 0.6rem; font-weight: 600; color: #64748b; margin-bottom: 0.2rem; text-transform: uppercase; letter-spacing: 0.3px;">Orders</div>
                                <div style="font-size: 0.85rem; font-weight: 800; color: #1e293b;">${trip.TOTAL_ORDERS}</div>
                            </div>
                        </div>

                        <!-- Auto Print Section -->
                        <div style="padding: 0.4rem 0.5rem; background: #f8fafc; border-radius: 5px; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                            <div style="display: flex; align-items: center; gap: 0.35rem;">
                                <i class="fas fa-print" style="color: #667eea; font-size: 0.65rem;"></i>
                                <span style="font-size: 0.65rem; color: #1e293b; font-weight: 600;">Auto Print</span>
                            </div>
                            <label class="toggle-switch" style="transform: scale(0.8);">
                                <input type="checkbox"
                                       class="auto-print-toggle"
                                       id="autoPrint_${trip.TRIP_ID}_${trip.TRIP_DATE}"
                                       data-trip-id="${trip.TRIP_ID}"
                                       data-trip-date="${trip.TRIP_DATE}"
                                       onchange="handleAutoPrintToggle('${trip.TRIP_ID}', '${trip.TRIP_DATE}', this.checked, ${trip.TOTAL_ORDERS})">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="auto-print-status" id="status_${trip.TRIP_ID}_${trip.TRIP_DATE}" style="margin-top: 0.35rem; padding: 0.3rem; font-size: 0.6rem; border-radius: 4px; display: none;"></div>
                    </div>

                    <!-- Card Footer -->
                    <div style="padding: 0.45rem 0.65rem; background: #f8f9fc; border-top: 1px solid #e2e8f0;">
                        <button class="btn btn-primary" onclick="openTripDetails('${trip.TRIP_ID}', '${trip.TRIP_DATE}', '${trip.LORRY_NUMBER}', '${trip.INSTANCE || ''}')" style="width: 100%; font-size: 0.65rem; padding: 0.4rem 0.6rem; justify-content: center;">
                            <i class="fas fa-eye"></i> View Details
                        </button>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        
        setTimeout(() => {
            loadAutoPrintStatuses();
        }, 100);
    }

    // Use stored tripMap for better data access
    window.openTripDetails = function(tripId, tripDate, lorryNumber, instanceFromCard) {
        console.log('[JS] Opening trip details for:', tripId);

        // Collapse sidebar when opening trip details
        const sidebar = document.getElementById('sidebar');
        if (sidebar && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
            console.log('[JS] Sidebar collapsed for trip details view');
        }

        // Get instance from trip card data first, fallback to localStorage
        let instance = instanceFromCard && instanceFromCard !== 'null' && instanceFromCard !== 'undefined' && instanceFromCard.trim() !== ''
            ? instanceFromCard
            : localStorage.getItem('fusionInstance');

        if (!instance) {
            alert('Instance not selected. Please select TEST or PROD from the instance selector in the toolbar.');
            return;
        }

        console.log('[JS] Using instance:', instance, '(from:', instanceFromCard ? 'trip card' : 'localStorage', ')');

        // Show loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'trip-details-loading';
        loadingDiv.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10002; display: flex; align-items: center; justify-content: center;';
        loadingDiv.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); text-align: center;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: #667eea; margin-bottom: 1rem;"></i>
                <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">Loading Trip Details...</div>
                <div style="font-size: 0.9rem; color: #64748b; margin-top: 0.5rem;">Trip ID: ${tripId}</div>
                <div style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Instance: ${instance}</div>
            </div>
        `;
        document.body.appendChild(loadingDiv);

        // Call GETTRIPDETAILS API
        const GET_TRIP_DETAILS_API = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/${tripId}?P_INSTANCE_NAME=${instance}`;

        console.log('[JS] Calling GETTRIPDETAILS API:', GET_TRIP_DETAILS_API);

        if (window.chrome && window.chrome.webview) {
            // WebView2 environment - use C# backend
            sendMessageToCSharp({
                action: 'executeGet',
                fullUrl: GET_TRIP_DETAILS_API
            }, function(error, data) {
                // Remove loading indicator
                const loading = document.getElementById('trip-details-loading');
                if (loading) loading.remove();

                if (error) {
                    console.error('[JS] Error loading trip details:', error);
                    alert('Error loading trip details:\n' + error);
                    return;
                }

                try {
                    const result = typeof data === 'string' ? JSON.parse(data) : data;
                    console.log('[JS] Trip details loaded from API:', result);

                    if (result && result.items && result.items.length > 0) {
                        const tripData = result.items;
                        openTripDetailsWithData(tripId, tripData, tripDate, lorryNumber);
                    } else {
                        alert('No data found for trip: ' + tripId);
                    }
                } catch (parseError) {
                    console.error('[JS] Error parsing trip details response:', parseError);
                    alert('Error processing trip details: ' + parseError.message);
                }
            });
        } else {
            // Fallback for browser testing
            fetch(GET_TRIP_DETAILS_API)
                .then(response => response.json())
                .then(result => {
                    // Remove loading indicator
                    const loading = document.getElementById('trip-details-loading');
                    if (loading) loading.remove();

                    console.log('[JS] Trip details loaded from API:', result);

                    if (result && result.items && result.items.length > 0) {
                        const tripData = result.items;
                        openTripDetailsWithData(tripId, tripData, tripDate, lorryNumber);
                    } else {
                        alert('No data found for trip: ' + tripId);
                    }
                })
                .catch(error => {
                    // Remove loading indicator
                    const loading = document.getElementById('trip-details-loading');
                    if (loading) loading.remove();

                    console.error('[JS] Error loading trip details:', error);
                    alert('Error loading trip details:\n' + error.message);
                });
        }
    };

    // Helper function to open trip details with data
    function openTripDetailsWithData(tripId, tripData, tripDate, lorryNumber) {
        console.log('[JS] Opening trip details with', tripData.length, 'records for trip:', tripId);
        
        // Create unique tab ID
        const tabId = 'trip-detail-' + tripId;
        
        // Check if tab already exists
        const existingTab = document.querySelector(`.tab-item[data-tab="${tabId}"]`);
        if (existingTab) {
            activateTripTab(tabId);
            return;
        }
        
        // Get first record for summary info
        const firstRecord = tripData[0];
        const totalOrders = tripData.length;
        
        // Calculate KPI statistics
        const uniqueCustomers = new Set(tripData.map(t => t.account_name || t.ACCOUNT_NAME || t.CUSTOMER_NAME).filter(x => x)).size;
        const uniqueProducts = new Set(tripData.map(t => t.PRODUCT_NAME || t.item_name || t.ITEM_NAME).filter(x => x)).size;
        const totalQuantity = tripData.reduce((sum, t) => sum + (parseFloat(t.QUANTITY || t.quantity || 0)), 0);
        const totalWeight = tripData.reduce((sum, t) => sum + (parseFloat(t.WEIGHT || t.weight || 0)), 0);
        const priority = firstRecord.TRIP_PRIORITY || firstRecord.trip_priority || firstRecord.PRIORITY || 'Medium';
        
        // Create tab item
        const tabHeader = document.getElementById('trip-tab-header');
        const tabItem = document.createElement('div');
        tabItem.className = 'tab-item';
        tabItem.dataset.tab = tabId;
        tabItem.innerHTML = `
            <span>Trip: ${tripId}</span>
            <span class="close-tab" onclick="closeTripTab('${tabId}', event)">&times;</span>
        `;
        tabItem.addEventListener('click', function(e) {
            if (!e.target.classList.contains('close-tab')) {
                activateTripTab(tabId);
            }
        });
        tabHeader.appendChild(tabItem);
        
        // Create tab pane with KPI cards and detailed content
        const tabContent = document.getElementById('trip-tab-content');
        const tabPane = document.createElement('div');
        tabPane.className = 'tab-pane';
        tabPane.id = `trip-${tabId}-tab`;
        tabPane.innerHTML = `
            <div style="padding: 1rem;">
                <!-- Trip Summary Section -->
                <div style="background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 1rem; overflow: hidden;">
                    <div onclick="toggleTripSummary('${tabId}')" style="padding: 1rem 1.25rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <div style="width: 40px; height: 40px; background: rgba(255,255,255,0.2); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-route" style="color: white; font-size: 1.2rem;"></i>
                            </div>
                            <div>
                                <h2 style="font-size: 1.1rem; font-weight: 700; color: white; margin: 0;">Trip: ${tripId}</h2>
                                <p style="color: rgba(255,255,255,0.9); font-size: 0.75rem; margin: 0.2rem 0 0 0;">Trip Summary & Statistics</p>
                            </div>
                        </div>
                        <i class="fas fa-chevron-down" id="summary-icon-${tabId}" style="color: white; font-size: 1rem; transition: transform 0.3s ease;"></i>
                    </div>

                    <div id="trip-summary-${tabId}" style="padding: 0.75rem; background: linear-gradient(to bottom, #f8f9fc 0%, #ffffff 100%);">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem;">
                            <!-- Trip Date Card -->
                            <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(99, 102, 241, 0.1); border-left: 3px solid #6366f1; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 2px 6px rgba(99, 102, 241, 0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(99, 102, 241, 0.1)';">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                                    <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #6366f1, #4f46e5); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                        <i class="fas fa-calendar-alt" style="color: white; font-size: 0.7rem;"></i>
                                    </div>
                                    <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Trip Date</div>
                                </div>
                                <div style="font-size: 0.85rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${tripDate}</div>
                            </div>

                            <!-- Lorry Number Card -->
                            <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(16, 185, 129, 0.1); border-left: 3px solid #10b981; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 2px 6px rgba(16, 185, 129, 0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(16, 185, 129, 0.1)';">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                                    <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #10b981, #059669); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                        <i class="fas fa-truck" style="color: white; font-size: 0.7rem;"></i>
                                    </div>
                                    <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Lorry</div>
                                </div>
                                <div style="font-size: 0.85rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${lorryNumber}</div>
                            </div>

                            <!-- Total Orders Card -->
                            <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(245, 158, 11, 0.1); border-left: 3px solid #f59e0b; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 2px 6px rgba(245, 158, 11, 0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(245, 158, 11, 0.1)';">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                                    <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #f59e0b, #d97706); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                        <i class="fas fa-box" style="color: white; font-size: 0.7rem;"></i>
                                    </div>
                                    <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Orders</div>
                                </div>
                                <div style="font-size: 1.0rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${totalOrders}</div>
                            </div>

                            <!-- Customers Card -->
                            <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(59, 130, 246, 0.1); border-left: 3px solid #3b82f6; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 2px 6px rgba(59, 130, 246, 0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(59, 130, 246, 0.1)';">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                                    <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #3b82f6, #2563eb); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                        <i class="fas fa-users" style="color: white; font-size: 0.7rem;"></i>
                                    </div>
                                    <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Customers</div>
                                </div>
                                <div style="font-size: 1.0rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${uniqueCustomers}</div>
                            </div>

                            <!-- Total Quantity Card -->
                            <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(139, 92, 246, 0.1); border-left: 3px solid #8b5cf6; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 2px 6px rgba(139, 92, 246, 0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(139, 92, 246, 0.1)';">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                                    <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                        <i class="fas fa-cubes" style="color: white; font-size: 0.7rem;"></i>
                                    </div>
                                    <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Quantity</div>
                                </div>
                                <div style="font-size: 1.0rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${totalQuantity.toLocaleString()}</div>
                            </div>

                            <!-- Total Weight Card -->
                            <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(236, 72, 153, 0.1); border-left: 3px solid #ec4899; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 2px 6px rgba(236, 72, 153, 0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(236, 72, 153, 0.1)';">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                                    <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #ec4899, #db2777); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                        <i class="fas fa-weight" style="color: white; font-size: 0.7rem;"></i>
                                    </div>
                                    <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Weight</div>
                                </div>
                                <div style="font-size: 0.85rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${totalWeight.toFixed(2)} kg</div>
                            </div>

                            <!-- Products Card -->
                            <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(20, 184, 166, 0.1); border-left: 3px solid #14b8a6; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 2px 6px rgba(20, 184, 166, 0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(20, 184, 166, 0.1)';">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                                    <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #14b8a6, #0d9488); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                        <i class="fas fa-boxes" style="color: white; font-size: 0.7rem;"></i>
                                    </div>
                                    <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Products</div>
                                </div>
                                <div style="font-size: 1.0rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${uniqueProducts}</div>
                            </div>

                            <!-- Priority Card -->
                            <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(239, 68, 68, 0.1); border-left: 3px solid ${priority.toLowerCase().includes('high') ? '#ef4444' : priority.toLowerCase().includes('low') ? '#22c55e' : '#f59e0b'}; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 2px 6px rgba(239, 68, 68, 0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(239, 68, 68, 0.1)';">
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                                    <div style="width: 28px; height: 28px; background: linear-gradient(135deg, ${priority.toLowerCase().includes('high') ? '#ef4444, #dc2626' : priority.toLowerCase().includes('low') ? '#22c55e, #16a34a' : '#f59e0b, #d97706'}); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                        <i class="fas fa-flag" style="color: white; font-size: 0.7rem;"></i>
                                    </div>
                                    <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Priority</div>
                                </div>
                                <div style="font-size: 0.85rem; font-weight: 800; color: ${priority.toLowerCase().includes('high') ? '#ef4444' : priority.toLowerCase().includes('low') ? '#22c55e' : '#f59e0b'}; margin-left: 2.15rem;">${priority}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="background: white; padding: 0.75rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="font-size: 0.85rem; font-weight: 600; margin: 0; color: var(--gray-800);">
                            <i class="fas fa-table" style="font-size: 0.75rem;"></i> Order Details
                        </h3>
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            <div style="color: var(--gray-600); font-size: 0.7rem;">
                                <i class="fas fa-info-circle" style="font-size: 0.65rem;"></i> Showing ${totalOrders} orders
                            </div>
                            <button class="btn btn-info" onclick="refreshTripDetails('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                                <i class="fas fa-sync-alt"></i> Refresh
                            </button>
                            <button class="btn btn-secondary" onclick="assignPickerToTrip('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                                <i class="fas fa-user-check"></i> Assign Picker
                            </button>
                            <button class="btn btn-success" onclick="allocateLotsForS2V('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                                <i class="fas fa-boxes"></i> Allocate Lots for S2V
                            </button>
                            <button class="btn btn-warning" onclick="pickReleaseAll('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                                <i class="fas fa-truck-loading"></i> Pick Release All
                            </button>
                            <button class="btn btn-primary" onclick="openAddOrdersModalForTrip('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                                <i class="fas fa-plus"></i> Add Orders
                            </button>
                        </div>
                    </div>
                    <div id="grid-${tabId}" style="height: 500px;"></div>
                </div>
            </div>
        `;
        tabContent.appendChild(tabPane);
        
        // Activate the new tab
        activateTripTab(tabId);
        
        // Initialize grid
        setTimeout(() => {
            try {
                console.log('[JS] Initializing DevExpress grid for trip:', tripId);
                const gridContainer = $(`#grid-${tabId}`);

                if (!gridContainer || gridContainer.length === 0) {
                    console.error('[JS] Grid container not found:', `#grid-${tabId}`);
                    return;
                }

                if (tripData.length === 0) {
                    gridContainer.html('<div style="padding:2rem;text-align:center;color:#64748b;">No data found</div>');
                    return;
                }

                console.log('[JS] Creating grid with', tripData.length, 'records');
                const first = tripData[0];
                const columns = Object.keys(first).map(key => {
                let col = { dataField: key, caption: key.replace(/_/g, ' ') };
                if (key === 'LINE_STATUS') {
                    col.cellTemplate = (container, options) => {
                        const val = options.value || 'Unknown';
                        const safeClass = String(val).toLowerCase()
                            .replace(/,/g, ' ')
                            .replace(/\s+/g, '-')
                            .replace(/[^a-z0-9-]/g, '')
                            .replace(/-+/g, '-')
                            .replace(/^-|-$/g, '') || 'unknown';
                        $(container).html(`<span class="status-badge status-${safeClass}">${val}</span>`);
                    };
                } else if (key.endsWith('_WEIGHT')) {
                    col.format = { type: 'fixedPoint', precision: 2 };
                    col.alignment = 'right';
                } else if (key.endsWith('_ITEMS') || !isNaN(Number(first[key]))) {
                    col.format = { type: 'fixedPoint', precision: 0 };
                    col.alignment = 'right';
                }
                return col;
            });

            // Add Actions column at the beginning
            columns.unshift({
                caption: 'Actions',
                width: 180,
                alignment: 'center',
                allowFiltering: false,
                allowSorting: false,
                cellTemplate: function(container, options) {
                    const rowData = options.data;
                    const instanceName = rowData.instance_name || rowData.INSTANCE_NAME || rowData.instance || rowData.INSTANCE || 'TEST';
                    const orderType = rowData.ORDER_TYPE || rowData.order_type || rowData.ORDER_TYPE_CODE || rowData.order_type_code || '';
                    const tripIdFromRow = rowData.TRIP_ID || rowData.trip_id || '';
                    const tripDateFromRow = rowData.TRIP_DATE || rowData.trip_date || '';
                    $(container).html(`
                        <div style="display: flex; gap: 0.5rem; justify-content: center;">
                            <button class="icon-btn" onclick="printStoreTransaction('${rowData.ORDER_NUMBER || rowData.order_number}', '${instanceName}', '${orderType}', '${tripIdFromRow}', '${tripDateFromRow}')" title="Print Store Transaction">
                                <i class="fas fa-print" style="color: #8b5cf6;"></i>
                            </button>
                            <button class="icon-btn" onclick="unassignPicker('${tripId}', '${rowData.ORDER_NUMBER || rowData.order_number}')" title="Unassign Picker">
                                <i class="fas fa-user-times" style="color: #ef4444;"></i>
                            </button>
                            <button class="icon-btn" onclick="pickRelease('${tripId}', '${rowData.ORDER_NUMBER || rowData.order_number}')" title="Pick Release">
                                <i class="fas fa-check-circle" style="color: #10b981;"></i>
                            </button>
                            <button class="icon-btn" onclick='editTripOrder(${JSON.stringify(rowData)})' title="Edit">
                                <i class="fas fa-edit" style="color: #3b82f6;"></i>
                            </button>
                            <button class="icon-btn" onclick="deleteTripOrder('${tripId}', '${rowData.ORDER_NUMBER || rowData.order_number}')" title="Delete">
                                <i class="fas fa-trash" style="color: #f59e0b;"></i>
                            </button>
                        </div>
                    `);
                }
            });

            gridContainer.dxDataGrid({
                dataSource: tripData,
                columns: columns,
                showBorders: true,
                columnAutoWidth: true,
                scrolling: { useNative: true, showScrollbar: 'always' },
                filterRow: { visible: true },
                headerFilter: { visible: true },
                searchPanel: { visible: true, placeholder: "Search..." },
                paging: { pageSize: 20 },
                pager: { showPageSizeSelector: true, allowedPageSizes: [10, 20, 50, 'all'] },
                allowColumnReordering: true,
                allowColumnResizing: true,
                columnResizingMode: 'widget',
                rowAlternationEnabled: true,
                selection: {
                    mode: 'multiple',
                    showCheckBoxesMode: 'always'
                },
                export: {
                    enabled: true,
                    allowExportSelectedData: true,
                    fileName: `Trip_${tripId}`
                },
                height: '100%'
            });

            console.log('[JS] ✅ Grid initialized successfully for trip:', tripId);

        } catch (error) {
            console.error('[JS] ❌ Error initializing grid:', error);
            const gridContainer = $(`#grid-${tabId}`);
            if (gridContainer && gridContainer.length > 0) {
                gridContainer.html(`
                    <div style="padding:2rem;text-align:center;">
                        <i class="fas fa-exclamation-triangle" style="font-size:3rem;color:#ef4444;margin-bottom:1rem;"></i>
                        <h3 style="color:#1f2937;margin-bottom:0.5rem;">Grid Initialization Error</h3>
                        <p style="color:#6b7280;">Error: ${error.message}</p>
                        <p style="color:#6b7280;font-size:0.85rem;">Check browser console for details.</p>
                    </div>
                `);
            }
        }
        }, 100);
    };

    window.closeTripTab = function(tabId, event) {
        event.stopPropagation();

        const tabItem = document.querySelector(`.tab-item[data-tab="${tabId}"]`);
        const tabPane = document.getElementById(`trip-${tabId}-tab`);

        const wasActive = tabItem && tabItem.classList.contains('active');

        if (tabItem) tabItem.remove();
        if (tabPane) tabPane.remove();

        if (wasActive) {
            activateTripTab('all-trips');
        }
    };

    // Open Add Orders modal for a trip from Trip Management
    window.openAddOrdersModalForTrip = function(tripId) {
        console.log('[Trip Management] Opening Add Orders modal for trip:', tripId);

        // Check if trip-details.js functions are available
        if (typeof window.openAddOrdersModal !== 'function') {
            alert('Add Orders functionality not available. Please refresh the page.');
            return;
        }

        // Find trip data from currentFullData
        const tripRecords = currentFullData.filter(trip => {
            const tripIdLower = (trip.trip_id || '').toString().toLowerCase();
            const tripIdUpper = (trip.TRIP_ID || '').toString().toLowerCase();
            const searchId = tripId.toString().toLowerCase();
            return tripIdLower === searchId || tripIdUpper === searchId;
        });

        if (tripRecords.length === 0) {
            alert('Trip data not found. Please try again.');
            return;
        }

        const firstRecord = tripRecords[0];

        // Set trip details data for trip-details.js to use
        if (typeof window.setTripDetailsDataForModal === 'function') {
            window.setTripDetailsDataForModal({
                trip_id: tripId,
                trip_date: firstRecord.TRIP_DATE || firstRecord.trip_date,
                trip_lorry: firstRecord.LORRY_NUMBER || firstRecord.trip_lorry || firstRecord.TRIP_LORRY,
                trip_loading_bay: firstRecord.TRIP_LOADING_BAY || firstRecord.trip_loading_bay,
                trip_priority: firstRecord.TRIP_PRIORITY || firstRecord.trip_priority || firstRecord.PRIORITY,
                vehicle: firstRecord.LORRY_NUMBER || firstRecord.trip_lorry || firstRecord.TRIP_LORRY,
                status: firstRecord.TRIP_STATUS || firstRecord.trip_status || 'ACTIVE'
            });
        }

        // Open the modal
        window.openAddOrdersModal();
    };

    // Refresh Trip Management grid after adding orders
    window.refreshTripManagementAfterAddOrders = function(tripId) {
        console.log('[Trip Management] Refreshing grid after adding orders to trip:', tripId);

        const tabId = 'trip-detail-' + tripId;
        const gridContainer = $(`#grid-${tabId}`);

        if (!gridContainer || gridContainer.length === 0) {
            console.log('[Trip Management] Grid not found, might be on Co-Pilot page');
            return;
        }

        // Get the grid instance
        const gridInstance = gridContainer.dxDataGrid('instance');
        if (gridInstance) {
            console.log('[Trip Management] Reloading grid data...');
            gridInstance.refresh();
        }

        // Also refresh the trip cards to update totals
        if (typeof window.fetchTripsData === 'function') {
            console.log('[Trip Management] Refreshing trip cards...');
            window.fetchTripsData();
        }
    };

    // Toggle trip summary section
    window.toggleTripSummary = function(tabId) {
        const summaryContent = document.getElementById(`trip-summary-${tabId}`);
        const summaryIcon = document.getElementById(`summary-icon-${tabId}`);

        if (summaryContent && summaryIcon) {
            if (summaryContent.style.display === 'none') {
                summaryContent.style.display = 'block';
                summaryIcon.style.transform = 'rotate(0deg)';
            } else {
                summaryContent.style.display = 'none';
                summaryIcon.style.transform = 'rotate(-90deg)';
            }
        }
    };

    // Assign Picker to selected orders in a trip
    window.assignPickerToTrip = function(tripId) {
        console.log('[Assign Picker] Trip ID:', tripId);

        // Get the grid instance - use correct tabId pattern
        const tabId = `trip-detail-${tripId}`;
        const gridId = `grid-${tabId}`;
        console.log('[Assign Picker] Looking for grid:', gridId);

        const gridContainer = $(`#${gridId}`);
        console.log('[Assign Picker] Grid container found:', gridContainer.length);

        if (!gridContainer || gridContainer.length === 0) {
            console.error('[Assign Picker] ❌ Grid not found:', gridId);
            alert('Grid not found. Please try again.');
            return;
        }

        const gridInstance = gridContainer.dxDataGrid('instance');
        if (!gridInstance) {
            alert('Grid instance not found. Please try again.');
            return;
        }

        // Get selected rows
        const selectedRows = gridInstance.getSelectedRowsData();

        if (!selectedRows || selectedRows.length === 0) {
            alert('Please select at least one order to assign a picker.');
            return;
        }

        console.log('[Assign Picker] Selected orders:', selectedRows);

        // Check if pickers data is loaded, if not load it first
        if (!window.pickersData || window.pickersData.length === 0) {
            console.log('[Assign Picker] Pickers not loaded, loading now...');

            // Show loading message
            const loadingMsg = document.createElement('div');
            loadingMsg.id = 'loading-pickers-msg';
            loadingMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000; text-align: center;';
            loadingMsg.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #667eea; margin-bottom: 1rem;"></i><br><span style="color: #1f2937; font-weight: 600;">Loading pickers...</span>';
            document.body.appendChild(loadingMsg);

            // Load pickers
            if (typeof window.loadPickers === 'function') {
                window.loadPickers();

                // Wait for pickers to load
                const checkInterval = setInterval(() => {
                    if (window.pickersData && window.pickersData.length > 0) {
                        clearInterval(checkInterval);
                        // Remove loading message
                        const msg = document.getElementById('loading-pickers-msg');
                        if (msg) msg.remove();
                        // Open dialog
                        openAssignPickerDialog(tripId, selectedRows);
                    }
                }, 500);

                // Timeout after 10 seconds
                setTimeout(() => {
                    clearInterval(checkInterval);
                    const msg = document.getElementById('loading-pickers-msg');
                    if (msg) msg.remove();
                    if (!window.pickersData || window.pickersData.length === 0) {
                        alert('Failed to load pickers. Please try again or visit the Pickers page first.');
                    }
                }, 10000);
            } else {
                const msg = document.getElementById('loading-pickers-msg');
                if (msg) msg.remove();
                alert('Pickers loading function not available. Please visit the Pickers page first to load picker data.');
            }
        } else {
            // Pickers already loaded, open dialog directly
            openAssignPickerDialog(tripId, selectedRows);
        }
    };

    // Open Assign Picker Dialog
    window.openAssignPickerDialog = function(tripId, selectedOrders) {
        console.log('[Assign Picker] Opening dialog for', selectedOrders.length, 'orders');

        // Build the list of selected order numbers
        let orderListHtml = '';
        selectedOrders.forEach((order, index) => {
            const orderNumber = order.ORDER_NUMBER || order.order_number || order.ORDER || order.order || `Order ${index + 1}`;
            const customerName = order.CUSTOMER_NAME || order.customer_name || order.CUSTOMER || order.customer || '';

            orderListHtml += `
                <div style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-weight: 600; color: #1f2937;">${orderNumber}</span>
                        ${customerName ? `<span style="color: #64748b; font-size: 0.85rem; margin-left: 0.5rem;">- ${customerName}</span>` : ''}
                    </div>
                    <span style="color: #64748b; font-size: 0.75rem;">${index + 1} of ${selectedOrders.length}</span>
                </div>
            `;
        });

        // Build picker dropdown options
        let pickerOptionsHtml = '<option value="">-- Select Picker --</option>';

        if (window.pickersData && window.pickersData.length > 0) {
            // Filter out deleted pickers
            const activePickers = window.pickersData.filter(p => p.deleted !== 1);
            activePickers.forEach(picker => {
                const pickerId = picker.picker_id || picker.PICKER_ID || picker.id || picker.ID || '';
                const pickerName = picker.name || picker.NAME || picker.picker_name || picker.PICKER_NAME || '';
                const pickerType = picker.picker_type || picker.PICKER_TYPE || picker.type || picker.TYPE || '';

                pickerOptionsHtml += `<option value="${pickerId}">${pickerName}${pickerType ? ' (' + pickerType + ')' : ''}</option>`;
            });
        } else {
            pickerOptionsHtml += '<option value="" disabled>No pickers available</option>';
        }

        // Create modal HTML
        const modalHtml = `
            <div id="assign-picker-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; justify-content: center; align-items: center;">
                <div style="background: white; width: 90%; max-width: 600px; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <!-- Header -->
                    <div style="padding: 1.25rem 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                        <h3 style="margin: 0; color: white; font-size: 1.1rem;">
                            <i class="fas fa-user-check"></i> Assign Picker
                        </h3>
                        <p style="margin: 0.5rem 0 0 0; color: rgba(255,255,255,0.9); font-size: 0.85rem;">
                            Trip ID: ${tripId} • ${selectedOrders.length} order(s) selected
                        </p>
                    </div>

                    <!-- Body -->
                    <div style="padding: 1.5rem; overflow-y: auto; max-height: 60vh;">
                        <!-- Selected Orders Section -->
                        <div style="margin-bottom: 1.5rem;">
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #1f2937; font-size: 0.9rem;">
                                <i class="fas fa-list"></i> Selected Orders
                            </label>
                            <div style="border: 1px solid #e2e8f0; border-radius: 8px; max-height: 200px; overflow-y: auto; background: #f8f9fc;">
                                ${orderListHtml}
                            </div>
                        </div>

                        <!-- Picker Selection -->
                        <div>
                            <label for="assign-picker-select" style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #1f2937; font-size: 0.9rem;">
                                <i class="fas fa-user"></i> Select Picker <span style="color: #ef4444;">*</span>
                            </label>
                            <select id="assign-picker-select" style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.9rem; background: white; color: #1f2937;">
                                ${pickerOptionsHtml}
                            </select>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; background: #f8f9fc; display: flex; gap: 0.75rem; justify-content: flex-end;">
                        <button class="btn btn-secondary" onclick="closeAssignPickerDialog()">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                        <button class="btn btn-primary" onclick="submitAssignPicker('${tripId}', ${JSON.stringify(selectedOrders).replace(/"/g, '&quot;')})">
                            <i class="fas fa-check"></i> Assign
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add modal to DOM
        const existingModal = document.getElementById('assign-picker-modal');
        if (existingModal) {
            existingModal.remove();
        }

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    };

    // Close Assign Picker Dialog
    window.closeAssignPickerDialog = function() {
        const modal = document.getElementById('assign-picker-modal');
        if (modal) {
            modal.remove();
        }
    };

    // Submit Assign Picker (POST to API via C# backend)
    window.submitAssignPicker = function(tripId, selectedOrders) {
        const pickerSelect = document.getElementById('assign-picker-select');
        const pickerId = pickerSelect.value;

        if (!pickerId) {
            alert('Please select a picker.');
            return;
        }

        const pickerName = pickerSelect.options[pickerSelect.selectedIndex].text;

        console.log('[Assign Picker] Assigning picker:', pickerId, pickerName);
        console.log('[Assign Picker] To orders:', selectedOrders);
        console.log('[Assign Picker] Trip ID:', tripId);

        // Get instance from toolbar
        const instance = localStorage.getItem('fusionInstance') || 'TEST';
        console.log('[Assign Picker] Instance:', instance);

        // Get current date for assignment
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

        // Build orders array for API
        const orders = selectedOrders.map(order => ({
            orderNumber: order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number || '',
            accountNumber: order.ACCOUNT_NUMBER || order.account_number || '',
            accountName: order.ACCOUNT_NAME || order.account_name || order.CUSTOMER_NAME || order.customer_name || '',
            pickerName: pickerName,
            loadingBay: order.LOADING_BAY || order.loading_bay || '',
            orderTypeCode: order.ORDER_TYPE_CODE || order.order_type_code || order.ORDER_TYPE || order.order_type || '',
            assignmentDate: today,
            pickslip: order.PICKSLIP || order.pickslip || '',
            pickwave: order.PICKWAVE || order.pickwave || '',
            instance: instance
        }));

        const payload = { orders };

        console.log('[Assign Picker] Payload:', payload);

        // Show loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'assign-picker-loading';
        loadingDiv.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; display: flex; align-items: center; justify-content: center;';
        loadingDiv.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); text-align: center;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: #667eea; margin-bottom: 1rem;"></i>
                <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">Assigning Picker...</div>
                <div style="font-size: 0.9rem; color: #64748b; margin-top: 0.5rem;">Processing ${orders.length} order(s)</div>
            </div>
        `;
        document.body.appendChild(loadingDiv);

        const PICKER_ASSIGNMENT_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/pickerassignment';

        if (window.chrome && window.chrome.webview) {
            // WebView2 environment - use C# backend
            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: PICKER_ASSIGNMENT_API,
                body: JSON.stringify(payload)
            }, function(error, data) {
                // Remove loading indicator
                const loading = document.getElementById('assign-picker-loading');
                if (loading) loading.remove();

                if (error) {
                    console.error('[Assign Picker] Error:', error);
                    alert('Error assigning picker:\n' + error);
                } else {
                    try {
                        const result = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log('[Assign Picker] API Response:', result);

                        if (result.success === true || result.success === 'true') {
                            // Success - show notification
                            const notification = document.createElement('div');
                            notification.style.cssText = 'position: fixed; top: 80px; right: 20px; background: #10b981; color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10002; font-weight: 600;';
                            notification.innerHTML = `
                                <i class="fas fa-check-circle"></i>
                                Successfully assigned <strong>${pickerName}</strong> to ${result.ordersAssigned || orders.length} order(s)
                            `;
                            document.body.appendChild(notification);

                            setTimeout(() => notification.remove(), 4000);

                            // Close dialog
                            closeAssignPickerDialog();

                            // Refresh the grid to show updated picker assignments
                            const tabId = `trip-detail-${tripId}`;
                            const gridId = `grid-${tabId}`;
                            const gridContainer = $(`#${gridId}`);
                            if (gridContainer && gridContainer.length > 0) {
                                const gridInstance = gridContainer.dxDataGrid('instance');
                                if (gridInstance) {
                                    gridInstance.refresh();
                                }
                            }
                        } else {
                            // Error from API
                            alert(`Failed to assign picker:\n${result.message || 'Unknown error'}`);
                        }
                    } catch (parseError) {
                        console.error('[Assign Picker] Error parsing response:', parseError);
                        alert('Error processing response: ' + parseError.message);
                    }
                }
            });
        } else {
            // Fallback for browser testing
            fetch(PICKER_ASSIGNMENT_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            })
            .then(response => response.json())
            .then(result => {
                // Remove loading indicator
                const loading = document.getElementById('assign-picker-loading');
                if (loading) loading.remove();

                console.log('[Assign Picker] API Response:', result);

                if (result.success === true || result.success === 'true') {
                    // Success - show notification
                    const notification = document.createElement('div');
                    notification.style.cssText = 'position: fixed; top: 80px; right: 20px; background: #10b981; color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10002; font-weight: 600;';
                    notification.innerHTML = `
                        <i class="fas fa-check-circle"></i>
                        Successfully assigned <strong>${pickerName}</strong> to ${result.ordersAssigned || orders.length} order(s)
                    `;
                    document.body.appendChild(notification);

                    setTimeout(() => notification.remove(), 4000);

                    // Close dialog
                    closeAssignPickerDialog();

                    // Refresh the grid
                    const tabId = `trip-detail-${tripId}`;
                    const gridId = `grid-${tabId}`;
                    const gridContainer = $(`#${gridId}`);
                    if (gridContainer && gridContainer.length > 0) {
                        const gridInstance = gridContainer.dxDataGrid('instance');
                        if (gridInstance) {
                            gridInstance.refresh();
                        }
                    }
                } else {
                    alert(`Failed to assign picker:\n${result.message || 'Unknown error'}`);
                }
            })
            .catch(error => {
                // Remove loading indicator
                const loading = document.getElementById('assign-picker-loading');
                if (loading) loading.remove();

                console.error('[Assign Picker] Error:', error);
                alert(`Error assigning picker:\n${error.message || 'Network error occurred'}`);
            });
        }
    };

    window.pickReleaseAll = function(tripId) {
        console.log('[Trip Management] Pick release all for trip:', tripId);
        alert('Pick Release All functionality - To be implemented');
    };

    // Allocate Lots for S2V - Process selected S2V orders
    window.allocateLotsForS2V = function(tripId) {
        console.log('[Allocate Lots S2V] Processing trip:', tripId);

        // Get the grid instance
        const tabId = `trip-detail-${tripId}`;
        const gridId = `grid-${tabId}`;
        const gridInstance = $(`#${gridId}`).dxDataGrid('instance');

        if (!gridInstance) {
            alert('Grid not found. Please refresh the page.');
            return;
        }

        // Get selected rows
        const selectedRows = gridInstance.getSelectedRowsData();

        if (selectedRows.length === 0) {
            alert('Please select at least one order from the grid.');
            return;
        }

        console.log('[Allocate Lots S2V] Selected rows:', selectedRows);

        // Debug: Log all order types found in selected rows
        selectedRows.forEach((row, idx) => {
            const orderType = row.ORDER_TYPE_CODE || row.order_type_code || row.ORDER_TYPE || row.order_type || 'NOT_FOUND';
            console.log(`[Allocate Lots S2V] Row ${idx + 1} Order Type:`, orderType);
        });

        // Filter only S2V/Store to Van order types
        const s2vOrders = selectedRows.filter(row => {
            const orderType = (row.ORDER_TYPE_CODE || row.order_type_code || row.ORDER_TYPE || row.order_type || '').toUpperCase();
            return orderType === 'S2V' || orderType === 'STORE TO VAN' || orderType.includes('STORE TO VAN');
        });

        console.log('[Allocate Lots S2V] Filtered S2V orders:', s2vOrders.length, 'out of', selectedRows.length);

        if (s2vOrders.length === 0) {
            alert('No Store to Van orders selected. This function only works for Store to Van order types.');
            return;
        }

        console.log('[Allocate Lots S2V] Store to Van orders found:', s2vOrders.length);

        // Create progress dialog
        const dialogHtml = `
            <div id="s2v-allocate-dialog" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10002; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); width: 90%; max-width: 800px; max-height: 80vh; display: flex; flex-direction: column;">
                    <div style="padding: 1.5rem; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.25rem; font-weight: 600; color: #1f2937;">
                            <i class="fas fa-boxes" style="color: #10b981;"></i> Allocate Lots for Store to Van Orders
                        </h3>
                        <button onclick="closeS2VDialog()" style="background: none; border: none; font-size: 1.5rem; color: #9ca3af; cursor: pointer; padding: 0; width: 30px; height: 30px;">&times;</button>
                    </div>
                    <div style="padding: 1.5rem; overflow-y: auto; flex: 1;">
                        <div style="margin-bottom: 1rem; padding: 1rem; background: #f0fdf4; border-left: 4px solid #10b981; border-radius: 4px;">
                            <div style="font-weight: 600; color: #065f46; margin-bottom: 0.25rem;">Processing ${s2vOrders.length} Store to Van Order(s)</div>
                            <div style="font-size: 0.875rem; color: #047857;">Calling Allocate Lots API for each transaction...</div>
                        </div>
                        <div id="s2v-progress-list" style="display: flex; flex-direction: column; gap: 0.75rem;">
                            ${s2vOrders.map((order, index) => {
                                const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number || 'Unknown';
                                return `
                                    <div id="s2v-item-${index}" style="padding: 1rem; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa;">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                            <div style="font-weight: 600; color: #1f2937;">#${index + 1}: ${orderNumber}</div>
                                            <div id="s2v-status-${index}" style="display: flex; align-items: center; gap: 0.5rem;">
                                                <i class="fas fa-clock" style="color: #9ca3af;"></i>
                                                <span style="color: #6b7280; font-size: 0.875rem;">Waiting...</span>
                                            </div>
                                        </div>
                                        <div id="s2v-details-${index}" style="font-size: 0.875rem; color: #6b7280;"></div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                    <div style="padding: 1rem 1.5rem; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #f9fafb;">
                        <div id="s2v-summary" style="font-size: 0.875rem; color: #6b7280;">Ready to process...</div>
                        <button onclick="closeS2VDialog()" class="btn btn-secondary" style="font-size: 0.875rem; padding: 0.5rem 1rem;">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add dialog to DOM
        const dialogDiv = document.createElement('div');
        dialogDiv.innerHTML = dialogHtml;
        document.body.appendChild(dialogDiv);

        // Process each S2V order
        processS2VOrders(s2vOrders, 0);
    };

    // Close S2V Dialog
    window.closeS2VDialog = function() {
        const dialog = document.getElementById('s2v-allocate-dialog');
        if (dialog) {
            dialog.remove();
        }
    };

    // Process S2V orders sequentially
    function processS2VOrders(orders, index) {
        if (index >= orders.length) {
            // All done
            document.getElementById('s2v-summary').innerHTML = '<span style="color: #10b981; font-weight: 600;"><i class="fas fa-check-circle"></i> All orders processed!</span>';
            return;
        }

        const order = orders[index];
        const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number || 'Unknown';
        const fusionInstance = localStorage.getItem('fusionInstance') || 'TEST';

        // Update status to processing
        const statusDiv = document.getElementById(`s2v-status-${index}`);
        statusDiv.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color: #3b82f6;"></i><span style="color: #3b82f6; font-size: 0.875rem;">Processing...</span>';

        // Update summary
        document.getElementById('s2v-summary').innerHTML = `Processing ${index + 1} of ${orders.length}...`;

        // Prepare POST data
        const postData = {
            p_trx_number: orderNumber,
            p_instance_name: fusionInstance
        };

        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fetchlotdetails';

        console.log(`[Allocate Lots S2V] Processing order ${index + 1}/${orders.length}:`, orderNumber);

        // Call API
        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            body: JSON.stringify(postData)
        }, function(error, data) {
            const detailsDiv = document.getElementById(`s2v-details-${index}`);

            if (error) {
                // Error
                statusDiv.innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444;"></i><span style="color: #ef4444; font-size: 0.875rem;">Failed</span>';
                detailsDiv.innerHTML = `<div style="color: #ef4444;">Error: ${error}</div>`;

                // Process next order
                setTimeout(() => processS2VOrders(orders, index + 1), 500);
            } else {
                try {
                    const response = JSON.parse(data);

                    if (response.success) {
                        const recordCount = response.recordCount || 0;
                        statusDiv.innerHTML = '<i class="fas fa-check-circle" style="color: #10b981;"></i><span style="color: #10b981; font-size: 0.875rem;">Success</span>';
                        detailsDiv.innerHTML = `
                            <div style="color: #10b981;">✓ ${response.message || 'Success'}</div>
                            <div style="color: #059669; margin-top: 0.25rem;"><strong>${recordCount}</strong> record(s) allocated</div>
                        `;
                    } else {
                        statusDiv.innerHTML = '<i class="fas fa-exclamation-circle" style="color: #f59e0b;"></i><span style="color: #f59e0b; font-size: 0.875rem;">Warning</span>';
                        detailsDiv.innerHTML = `<div style="color: #f59e0b;">${response.message || 'Unknown error'}</div>`;
                    }
                } catch (parseError) {
                    statusDiv.innerHTML = '<i class="fas fa-exclamation-circle" style="color: #f59e0b;"></i><span style="color: #f59e0b; font-size: 0.875rem;">Parse Error</span>';
                    detailsDiv.innerHTML = `<div style="color: #f59e0b;">Parse Error: ${parseError.message}</div>`;
                }

                // Process next order
                setTimeout(() => processS2VOrders(orders, index + 1), 500);
            }
        });
    }

    window.unassignPicker = function(tripId, orderNumber) {
        console.log('[Trip Management] Unassign picker for order:', orderNumber);
        alert('Unassign Picker functionality - To be implemented');
    };

    window.pickRelease = function(tripId, orderNumber) {
        console.log('[Trip Management] Pick release for order:', orderNumber);
        alert('Pick Release functionality - To be implemented');
    };

    // Print Store Transaction - calls C# Fusion PDF handler
    window.printStoreTransaction = function(orderNumber, instanceFromRow, orderTypeFromRow, tripIdFromRow, tripDateFromRow) {
        console.log('[Print Store Transaction] Printing for order:', orderNumber);

        // Get instance from row data first, fallback to localStorage
        const instance = instanceFromRow || localStorage.getItem('fusionInstance') || 'TEST';
        console.log('[Print Store Transaction] Using instance:', instance, '(from:', instanceFromRow ? 'row data' : 'localStorage', ')');

        // Get order type from parameter first, then fallback to global (for backward compatibility)
        const orderType = (orderTypeFromRow || window.currentStoreTransOrderType || '').toUpperCase().trim();

        // Debug: Show exact order type value
        console.log('[Print Store Transaction] Order Type from row:', orderTypeFromRow);
        console.log('[Print Store Transaction] Order Type from global:', window.currentStoreTransOrderType);
        console.log('[Print Store Transaction] Final Order Type:', orderType, '(from:', orderTypeFromRow ? 'row data' : 'global variable', ')');
        console.log('[Print Store Transaction] Order Type Length:', orderType.length);

        // Determine report based on order type
        let reportPath, parameterName, reportName;

        // Simple logic: Check if ORDER_TYPE is exactly "Store to Van" or "Van to Store"
        if (orderType === 'STORE TO VAN' || orderType === 'VAN TO STORE') {
            // Store to Van / Van to Store - use Store Transaction report
            reportPath = '/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo';
            parameterName = 'SOURCE_CODE';
            reportName = 'Store Transaction Report';
        } else {
            // All other order types - use Sales Order report
            reportPath = '/Custom/OQ/GR_SalesOrder_Rep.xdo';
            parameterName = 'Order_Number';
            reportName = 'Sales Order Report';
        }

        console.log('[Print Store Transaction] Order Type:', orderType);
        console.log('[Print Store Transaction] Using:', reportName);
        console.log('[Print Store Transaction] Report Path:', reportPath);
        console.log('[Print Store Transaction] Parameter:', parameterName, '=', orderNumber);

        // Build SOAP XML payload for debug display
        const soapXmlPayload = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>${reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues>
           <v2:listOfParamNameValues>
            <v2:item>
              <v2:name>${parameterName}</v2:name>
              <v2:values>
                <v2:item>${orderNumber}</v2:item>
              </v2:values>
            </v2:item>
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:reportData/>
        <v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>[credentials]</v2:userID>
      <v2:password>[credentials]</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>`;

        // Log to debug window
        logDebugInfo(
            `Print Report - ${reportName}`,
            `${instance} - ${reportPath}`,
            {
                orderType: orderType,
                reportPath: reportPath,
                parameterName: parameterName,
                parameterValue: orderNumber,
                instance: instance,
                soapPayload: soapXmlPayload
            },
            null,
            null,
            'SOAP'
        );

        // Show loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'print-loading-indicator';
        loadingDiv.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; display: flex; align-items: center; justify-content: center;';
        loadingDiv.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); text-align: center;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: #8b5cf6; margin-bottom: 1rem;"></i>
                <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">Generating PDF Report...</div>
                <div style="font-size: 0.9rem; color: #64748b; margin-top: 0.5rem;">${reportName}</div>
                <div style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Order: ${orderNumber}</div>
                <div style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Instance: ${instance}</div>
            </div>
        `;
        document.body.appendChild(loadingDiv);

        // Get tripId and tripDate from parameters first, then fallback to globals (for backward compatibility)
        const tripId = String(tripIdFromRow || window.currentStoreTransTripId || '');
        const tripDate = String(tripDateFromRow || window.currentStoreTransTripDate || '');

        console.log('[Print Store Transaction] TripId from row:', tripIdFromRow);
        console.log('[Print Store Transaction] TripId from global:', window.currentStoreTransTripId);
        console.log('[Print Store Transaction] Final TripId:', tripId, '(from:', tripIdFromRow ? 'row data' : 'global variable', ')');
        console.log('[Print Store Transaction] TripDate from row:', tripDateFromRow);
        console.log('[Print Store Transaction] TripDate from global:', window.currentStoreTransTripDate);
        console.log('[Print Store Transaction] Final TripDate:', tripDate, '(from:', tripDateFromRow ? 'row data' : 'global variable', ')');

        // Call C# handler
        sendMessageToCSharp({
            action: 'printStoreTransaction',
            orderNumber: orderNumber,
            instance: instance,
            reportPath: reportPath,
            parameterName: parameterName,
            tripId: tripId,
            tripDate: tripDate
        }, function(error, data) {
            // Remove loading indicator
            const loading = document.getElementById('print-loading-indicator');
            if (loading) loading.remove();

            console.log('[Print Store Transaction] ===== RESPONSE RECEIVED =====');
            console.log('[Print Store Transaction] Error:', error);
            console.log('[Print Store Transaction] Data type:', typeof data);
            console.log('[Print Store Transaction] Data value:', data);
            console.log('[Print Store Transaction] ===============================');

            if (error) {
                // Log error to debug
                logDebugInfo(
                    `Print Report - ${reportName} - ERROR`,
                    `${instance} - ${reportPath}`,
                    { orderNumber, parameterName },
                    null,
                    error,
                    'SOAP'
                );
                alert('Error generating report: ' + error);
            } else {
                try {
                    const response = typeof data === 'string' ? JSON.parse(data) : data;
                    console.log('[Print Store Transaction] Parsed JSON response:', response);

                    // Log success to debug
                    logDebugInfo(
                        `Print Report - ${reportName} - SUCCESS`,
                        `${instance} - ${reportPath}`,
                        { orderNumber, parameterName },
                        response,
                        null,
                        'SOAP'
                    );

                    if (response.success) {
                        // Show PDF viewer dialog if pdfPath or filePath is available
                        const pdfPath = response.pdfPath || response.filePath || response.path;
                        if (pdfPath) {
                            console.log('[Print Store Transaction] Opening PDF viewer with path:', pdfPath);
                            showPdfViewer(pdfPath, orderNumber, reportName);
                        } else {
                            console.log('[Print Store Transaction] No PDF path in response');
                            console.log('[Print Store Transaction] Response object:', JSON.stringify(response));
                            alert('Report generated successfully and downloaded!\n\nNote: PDF path not found in response.\nChecked: pdfPath, filePath, path');
                        }
                    } else {
                        alert('Failed to generate report: ' + (response.message || 'Unknown error'));
                    }
                } catch (parseError) {
                    // If not JSON, check if it's a file path or success message
                    console.log('[Print Store Transaction] ===== NON-JSON RESPONSE =====');
                    console.log('[Print Store Transaction] Parse error:', parseError.message);
                    console.log('[Print Store Transaction] Raw data:', data);
                    console.log('[Print Store Transaction] Data type:', typeof data);
                    console.log('[Print Store Transaction] =====================================');

                    // Check if data looks like a file path (contains backslashes or .pdf)
                    if (data && typeof data === 'string' && (data.includes('\\') || data.includes('.pdf') || data.includes('C:') || data.includes('/'))) {
                        // Assume it's a PDF file path
                        const pdfPath = data.trim();
                        console.log('[Print Store Transaction] ✓ Detected as file path:', pdfPath);

                        logDebugInfo(
                            `Print Report - ${reportName} - SUCCESS`,
                            `${instance} - ${reportPath}`,
                            { orderNumber, parameterName },
                            { success: true, pdfPath: pdfPath },
                            null,
                            'SOAP'
                        );

                        console.log('[Print Store Transaction] Opening PDF viewer with path:', pdfPath);
                        // Show PDF viewer
                        showPdfViewer(pdfPath, orderNumber, reportName);
                    } else {
                        // Just a success message
                        console.log('[Print Store Transaction] Detected as success message, not a file path');
                        logDebugInfo(
                            `Print Report - ${reportName} - SUCCESS`,
                            `${instance} - ${reportPath}`,
                            { orderNumber, parameterName },
                            { success: true, message: data },
                            null,
                            'SOAP'
                        );
                        alert('Report generated successfully!\n\nNote: PDF path not detected in response.\nResponse: ' + data);
                    }
                }
            }
        });
    };

    // Show PDF Viewer Dialog
    window.showPdfViewer = function(pdfPath, orderNumber, reportName) {
        console.log('[PDF Viewer] Opening PDF:', pdfPath);

        // Create modal overlay
        const modal = document.createElement('div');
        modal.id = 'pdf-viewer-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 10003; display: flex; align-items: center; justify-content: center; padding: 2rem;';

        modal.innerHTML = `
            <div style="background: white; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); width: 100%; max-width: 1200px; height: 90vh; display: flex; flex-direction: column; overflow: hidden;">
                <!-- Header -->
                <div style="padding: 1.25rem 1.5rem; background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: white; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0;">
                    <div>
                        <div style="font-size: 1.2rem; font-weight: 700;">${reportName}</div>
                        <div style="font-size: 0.85rem; opacity: 0.9; margin-top: 0.25rem;">Order: ${orderNumber}</div>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button onclick="window.open('file:///${pdfPath.replace(/\\/g, '/')}')" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                            <i class="fas fa-external-link-alt"></i> Open External
                        </button>
                        <button onclick="document.getElementById('pdf-viewer-modal').remove()" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>

                <!-- PDF Viewer Body -->
                <div style="flex: 1; overflow: auto; background: #f1f5f9; display: flex; align-items: center; justify-content: center; padding: 1rem;">
                    <iframe src="file:///${pdfPath.replace(/\\/g, '/')}" style="width: 100%; height: 100%; border: none; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-radius: 8px;"></iframe>
                </div>

                <!-- Footer -->
                <div style="padding: 0.75rem 1.5rem; background: #f8f9fc; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 0.75rem; color: #64748b;">
                        <i class="fas fa-file-pdf" style="color: #ef4444; margin-right: 0.5rem;"></i>
                        ${pdfPath}
                    </div>
                    <button onclick="navigator.clipboard.writeText('${pdfPath}')" style="background: #667eea; border: none; color: white; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 600;" onmouseover="this.style.background='#5568d3'" onmouseout="this.style.background='#667eea'">
                        <i class="fas fa-copy"></i> Copy Path
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close on overlay click
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });
    };

    // Refresh Trip Details - calls GET endpoint to reload trip data
    window.refreshTripDetails = function(tripId) {
        console.log('[Refresh Trip] Refreshing trip:', tripId);

        // Get instance - try from trip data first, then fall back to toolbar
        let instance = localStorage.getItem('fusionInstance') || 'TEST';

        // Check if we have trip data with instance
        const tabId = `trip-detail-${tripId}`;
        const gridId = `grid-${tabId}`;
        const gridContainer = $(`#${gridId}`);

        if (gridContainer && gridContainer.length > 0) {
            const gridInstance = gridContainer.dxDataGrid('instance');
            if (gridInstance) {
                const dataSource = gridInstance.option('dataSource');
                if (dataSource && dataSource.length > 0 && dataSource[0].INSTANCE) {
                    instance = dataSource[0].INSTANCE;
                    console.log('[Refresh Trip] Using instance from trip data:', instance);
                } else {
                    console.log('[Refresh Trip] Using instance from toolbar:', instance);
                }
            }
        }

        const GET_TRIP_DETAILS_API = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/${tripId}?P_INSTANCE_NAME=${instance}`;

        console.log('[Refresh Trip] API URL:', GET_TRIP_DETAILS_API);

        // Show loading indicator
        const refreshBtn = event.target.closest('button');
        const originalBtnHtml = refreshBtn.innerHTML;
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';

        if (window.chrome && window.chrome.webview) {
            // WebView2 environment - use C# backend
            sendMessageToCSharp({
                action: 'executeGet',
                fullUrl: GET_TRIP_DETAILS_API
            }, function(error, data) {
                // Restore button
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = originalBtnHtml;

                if (error) {
                    console.error('[Refresh Trip] Error:', error);
                    alert('Error refreshing trip data:\n' + error);
                } else {
                    try {
                        const result = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log('[Refresh Trip] Data received:', result);

                        if (result && result.items && result.items.length > 0) {
                            // Update grid with new data
                            const gridContainer = $(`#${gridId}`);
                            if (gridContainer && gridContainer.length > 0) {
                                const gridInstance = gridContainer.dxDataGrid('instance');
                                if (gridInstance) {
                                    gridInstance.option('dataSource', result.items);
                                    gridInstance.refresh();

                                    // Update order count
                                    const orderCountDiv = gridContainer.closest('.trip-tab-pane').find('.fa-info-circle').parent();
                                    if (orderCountDiv.length > 0) {
                                        orderCountDiv.html(`<i class="fas fa-info-circle" style="font-size: 0.65rem;"></i> Showing ${result.items.length} orders`);
                                    }

                                    // Show success notification
                                    const notification = document.createElement('div');
                                    notification.style.cssText = 'position: fixed; top: 80px; right: 20px; background: #10b981; color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10002; font-weight: 600;';
                                    notification.innerHTML = `<i class="fas fa-check-circle"></i> Trip refreshed - ${result.items.length} order(s) loaded`;
                                    document.body.appendChild(notification);
                                    setTimeout(() => notification.remove(), 3000);
                                }
                            }
                        } else {
                            alert('No data returned from API');
                        }
                    } catch (parseError) {
                        console.error('[Refresh Trip] Error parsing response:', parseError);
                        alert('Error processing response: ' + parseError.message);
                    }
                }
            });
        } else {
            // Fallback for browser testing
            fetch(GET_TRIP_DETAILS_API)
                .then(response => response.json())
                .then(result => {
                    // Restore button
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = originalBtnHtml;

                    console.log('[Refresh Trip] Data received:', result);

                    if (result && result.items && result.items.length > 0) {
                        // Update grid with new data
                        const gridContainer = $(`#${gridId}`);
                        if (gridContainer && gridContainer.length > 0) {
                            const gridInstance = gridContainer.dxDataGrid('instance');
                            if (gridInstance) {
                                gridInstance.option('dataSource', result.items);
                                gridInstance.refresh();

                                // Update order count
                                const orderCountDiv = gridContainer.closest('.trip-tab-pane').find('.fa-info-circle').parent();
                                if (orderCountDiv.length > 0) {
                                    orderCountDiv.html(`<i class="fas fa-info-circle" style="font-size: 0.65rem;"></i> Showing ${result.items.length} orders`);
                                }

                                // Show success notification
                                const notification = document.createElement('div');
                                notification.style.cssText = 'position: fixed; top: 80px; right: 20px; background: #10b981; color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10002; font-weight: 600;';
                                notification.innerHTML = `<i class="fas fa-check-circle"></i> Trip refreshed - ${result.items.length} order(s) loaded`;
                                document.body.appendChild(notification);
                                setTimeout(() => notification.remove(), 3000);
                            }
                        }
                    } else {
                        alert('No data returned from API');
                    }
                })
                .catch(error => {
                    // Restore button
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = originalBtnHtml;

                    console.error('[Refresh Trip] Error:', error);
                    alert('Error refreshing trip data:\n' + error.message);
                });
        }
    };

    window.editTripOrder = function(rowData) {
        console.log('[Trip Management] Edit order:', rowData);

        const orderType = rowData.ORDER_TYPE || rowData.order_type || '';

        // Check if order type is 'Store to Van' or 'Van to Store'
        if (orderType === 'Store to Van' || orderType === 'Van to Store') {
            openStoreTransactionsDialog(rowData);
        } else {
            alert('Store Transactions dialog is only available for "Store to Van" or "Van to Store" order types.');
        }
    };

    function openStoreTransactionsDialog(rowData) {
        console.log('[Store Transactions] Opening dialog for order:', rowData);

        const orderNumber = rowData.ORDER_NUMBER || rowData.order_number || '';
        const orderType = rowData.ORDER_TYPE || rowData.order_type || rowData.ORDER_TYPE_CODE || rowData.order_type_code || '';
        const tripId = rowData.TRIP_ID || rowData.trip_id || '';
        const tripDate = rowData.TRIP_DATE || rowData.trip_date || '';
        const accountNumber = rowData.ACCOUNT_NUMBER || rowData.account_number || '';
        const accountName = rowData.ACCOUNT_NAME || rowData.account_name || '';
        const picker = rowData.PICKER || rowData.picker || '';
        const lorry = rowData.LORRY_NUMBER || rowData.lorry_number || '';
        const priority = rowData.PRIORITY || rowData.priority || '';
        const pickConfirmSt = rowData.PICK_CONFIRM_ST || rowData.pick_confirm_st || '';
        const instance = rowData.instance_name || rowData.INSTANCE_NAME || rowData.instance || rowData.INSTANCE || 'TEST';

        // Debug: Log the exact ORDER_TYPE value
        console.log('===========================================');
        console.log('[Store Transactions] ORDER_TYPE from rowData:', orderType);
        console.log('[Store Transactions] ORDER_TYPE length:', orderType.length);
        console.log('[Store Transactions] ORDER_TYPE char codes:', Array.from(orderType).map(c => c.charCodeAt(0)));
        console.log('===========================================');

        // Store order type, tripId, and tripDate in globals for print function
        window.currentStoreTransOrderType = orderType;
        window.currentStoreTransTripId = String(tripId);  // Convert to string for C# handler
        window.currentStoreTransTripDate = tripDate;

        // Create modal HTML
        const modalHtml = `
            <div id="store-transactions-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; justify-content: center; align-items: center;">
                <div style="background: white; width: 95%; max-width: 1400px; height: 90%; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <!-- Modal Header -->
                    <div style="padding: 0.75rem 1rem; border-bottom: 2px solid #e2e8f0; background: whitesmoke;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                            <h2 style="margin: 0; font-size: 1.1rem; color: #1e293b; font-weight: 700;">
                                <i class="fas fa-exchange-alt" style="color: #667eea;"></i> Store Transactions
                            </h2>
                            <div style="display: flex; gap: 0.5rem; align-items: center;">
                                <button onclick="printStoreTransaction('${orderNumber}', '${instance}', '${orderType}', '${tripId}', '${tripDate}')" style="background: #8b5cf6; border: none; cursor: pointer; color: white; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.3rem; transition: all 0.2s;" onmouseover="this.style.background='#7c3aed';" onmouseout="this.style.background='#8b5cf6';" title="Print Store Transaction">
                                    <i class="fas fa-print"></i> Print
                                </button>
                                <button onclick="closeStoreTransactionsModal()" style="background: transparent; border: 1px solid #cbd5e1; font-size: 20px; cursor: pointer; color: #64748b; padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.2s;" onmouseover="this.style.background='#e2e8f0'; this.style.color='#1e293b';" onmouseout="this.style.background='transparent'; this.style.color='#64748b';">
                                    ×
                                </button>
                            </div>
                        </div>

                        <!-- Header Details -->
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.5rem; padding: 0.6rem; background: white; border-radius: 6px; border: 1px solid #e2e8f0;">
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Trip ID:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${tripId}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Order Number:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${orderNumber}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Instance:</span><br><strong style="color: #8b5cf6; font-size: 0.8rem; font-weight: 700;">${instance}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Date:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${tripDate}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Account Number:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${accountNumber}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Account Name:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${accountName}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Picker:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${picker}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Lorry:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${lorry}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Priority:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${priority}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Pick Confirm St:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${pickConfirmSt}</strong></div>
                        </div>
                    </div>

                    <!-- Tab Header -->
                    <div style="display: flex; gap: 0.5rem; padding: 0.75rem 1.5rem; background: #f8f9fc; border-bottom: 2px solid #e2e8f0;">
                        <button class="store-trans-tab active" data-tab="transaction-details" onclick="switchStoreTransTab('transaction-details')" style="padding: 0.5rem 1.5rem; border: none; background: white; border-radius: 6px; cursor: pointer; font-weight: 600; color: #667eea; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            Transaction Details
                        </button>
                        <button class="store-trans-tab" data-tab="qoh-details" onclick="switchStoreTransTab('qoh-details')" style="padding: 0.5rem 1.5rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b;">
                            QOH Details
                        </button>
                        <button class="store-trans-tab" data-tab="allocated-lots" onclick="switchStoreTransTab('allocated-lots')" style="padding: 0.5rem 1.5rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b;">
                            Allocated Lots
                        </button>
                        <button class="store-trans-tab" data-tab="debug" onclick="switchStoreTransTab('debug')" style="padding: 0.5rem 1.5rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b;">
                            <i class="fas fa-bug"></i> Debug
                        </button>
                    </div>

                    <!-- Tab Content -->
                    <div style="flex: 1; overflow: hidden; position: relative;">
                        <!-- Tab 1: Transaction Details -->
                        <div id="store-trans-transaction-details" class="store-trans-tab-content active" style="height: 100%; overflow: auto; padding: 1rem;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshTransactionDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                                <button class="btn btn-primary" onclick="fetchLotDetails('${orderNumber}')" id="fetch-lot-btn" style="display: none;">
                                    <i class="fas fa-list"></i> Fetch Lot Details
                                </button>
                            </div>
                            <div id="transaction-details-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="transaction-details-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 2: QOH Details -->
                        <div id="store-trans-qoh-details" class="store-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshQOHDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="qoh-details-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="qoh-details-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 3: Allocated Lots -->
                        <div id="store-trans-allocated-lots" class="store-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button class="btn btn-secondary" onclick="refreshAllocatedLots('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                                <button class="btn btn-primary" onclick="processTransaction('${orderNumber}')">
                                    <i class="fas fa-cogs"></i> Process Transaction
                                </button>
                                <button class="btn btn-secondary" onclick="setData('${orderNumber}')">
                                    <i class="fas fa-database"></i> Set Data
                                </button>
                                <button class="btn btn-info" onclick="checkFusionStatus('${orderNumber}')">
                                    <i class="fas fa-check-circle"></i> Check Fusion Status
                                </button>
                            </div>
                            <div id="allocated-lots-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="allocated-lots-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 4: Debug -->
                        <div id="store-trans-debug" class="store-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; justify-content: space-between; align-items: center;">
                                <h3 style="margin: 0; font-size: 0.9rem; color: #1e293b;">
                                    <i class="fas fa-bug"></i> Debug Log
                                </h3>
                                <button class="btn btn-secondary" onclick="clearDebugLog()" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                                    <i class="fas fa-trash"></i> Clear Log
                                </button>
                            </div>
                            <div id="debug-log-content" style="background: #1e293b; border-radius: 8px; padding: 1rem; font-family: 'Courier New', monospace; font-size: 0.75rem; color: #10b981; height: calc(100% - 3rem); overflow: auto;">
                                <div style="color: #64748b; text-align: center; padding: 2rem;">
                                    <i class="fas fa-info-circle" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
                                    <p>Debug log will appear here when you click any button</p>
                                    <p style="font-size: 0.7rem; margin-top: 0.5rem;">Endpoints, JSON payloads, and responses will be logged</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add modal to body
        const existingModal = document.getElementById('store-transactions-modal');
        if (existingModal) {
            existingModal.remove();
        }
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Auto-load all tabs data
        console.log('[Store Transactions] Auto-loading all tab data for order:', orderNumber);
        setTimeout(() => {
            refreshTransactionDetails(orderNumber);
            refreshQOHDetails(orderNumber);
            refreshAllocatedLots(orderNumber);
        }, 100);
    }

    window.closeStoreTransactionsModal = function() {
        const modal = document.getElementById('store-transactions-modal');
        if (modal) {
            modal.remove();
        }
    };

    window.switchStoreTransTab = function(tabName) {
        // Update tab buttons
        document.querySelectorAll('.store-trans-tab').forEach(tab => {
            if (tab.dataset.tab === tabName) {
                tab.style.background = 'white';
                tab.style.color = '#667eea';
                tab.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            } else {
                tab.style.background = 'transparent';
                tab.style.color = '#64748b';
                tab.style.boxShadow = 'none';
            }
        });

        // Update tab content
        document.querySelectorAll('.store-trans-tab-content').forEach(content => {
            content.style.display = 'none';
        });
        const activeContent = document.getElementById(`store-trans-${tabName}`);
        if (activeContent) {
            activeContent.style.display = 'block';
        }
    };

    // Debug logging function
    window.logDebugInfo = function(action, endpoint, payload, response, error, method) {
        const debugContent = document.getElementById('debug-log-content');
        if (!debugContent) return;

        // Clear welcome message if it exists
        const welcomeMsg = debugContent.querySelector('div[style*="text-align: center"]');
        if (welcomeMsg) {
            debugContent.innerHTML = '';
        }

        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.style.cssText = 'margin-bottom: 1.5rem; padding: 1rem; background: #0f172a; border-radius: 6px; border-left: 4px solid #667eea;';

        let html = `
            <div style="color: #10b981; font-weight: 700; margin-bottom: 0.5rem;">
                [${timestamp}] ${action}
            </div>
        `;

        if (method) {
            const methodColor = method === 'POST' ? '#f59e0b' : (method === 'SOAP' ? '#a855f7' : '#06b6d4');
            html += `
                <div style="display: inline-block; background: ${methodColor}; color: white; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; margin-bottom: 0.5rem;">
                    ${method}
                </div>
            `;
        }

        if (endpoint) {
            html += `
                <div style="color: #60a5fa; margin-bottom: 0.5rem; margin-top: 0.5rem;">
                    <strong>Endpoint:</strong>
                </div>
                <div style="color: #cbd5e1; margin-bottom: 0.75rem; word-break: break-all; font-size: 0.7rem;">
                    ${endpoint}
                </div>
            `;
        }

        if (payload) {
            html += `
                <div style="color: #fbbf24; margin-bottom: 0.5rem;">
                    <strong>Payload:</strong>
                </div>
            `;

            // Special handling for SOAP XML
            if (method === 'SOAP' && payload.soapPayload) {
                // Show SOAP XML with syntax highlighting
                const escapedXml = payload.soapPayload
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');

                html += `
                    <pre style="color: #e2e8f0; background: #1e293b; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.7rem; margin-bottom: 0.75rem; max-height: 300px;">${escapedXml}</pre>
                `;

                // Show other fields except soapPayload
                const { soapPayload, ...otherFields } = payload;
                if (Object.keys(otherFields).length > 0) {
                    html += `
                        <div style="color: #fbbf24; margin-bottom: 0.5rem; margin-top: 0.5rem;">
                            <strong>Parameters:</strong>
                        </div>
                        <pre style="color: #e2e8f0; background: #1e293b; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.7rem; margin-bottom: 0.75rem;">${JSON.stringify(otherFields, null, 2)}</pre>
                    `;
                }
            } else {
                // Regular JSON display
                html += `
                    <pre style="color: #e2e8f0; background: #1e293b; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.7rem; margin-bottom: 0.75rem;">${JSON.stringify(payload, null, 2)}</pre>
                `;
            }
        }

        if (response) {
            html += `
                <div style="color: #34d399; margin-bottom: 0.5rem;">
                    <strong>Response:</strong>
                </div>
                <pre style="color: #e2e8f0; background: #1e293b; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.7rem;">${JSON.stringify(response, null, 2)}</pre>
            `;
        }

        if (error) {
            html += `
                <div style="color: #f87171; margin-bottom: 0.5rem;">
                    <strong>Error:</strong>
                </div>
                <div style="color: #fca5a5; background: #7f1d1d; padding: 0.5rem; border-radius: 4px; font-size: 0.7rem;">
                    ${error}
                </div>
            `;
        }

        logEntry.innerHTML = html;
        debugContent.insertBefore(logEntry, debugContent.firstChild);
    };

    // Clear debug log
    window.clearDebugLog = function() {
        const debugContent = document.getElementById('debug-log-content');
        if (debugContent) {
            debugContent.innerHTML = `
                <div style="color: #64748b; text-align: center; padding: 2rem;">
                    <i class="fas fa-info-circle" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
                    <p>Debug log cleared</p>
                    <p style="font-size: 0.7rem; margin-top: 0.5rem;">New actions will be logged here</p>
                </div>
            `;
        }
    };

    window.refreshTransactionDetails = async function(orderNumber) {
        console.log('[Store Transactions] Refreshing transaction details for:', orderNumber);

        const gridContainer = document.getElementById('transaction-details-grid');
        if (!gridContainer) {
            console.error('[Store Transactions] Grid container not found');
            return;
        }

        // Show loading indicator
        gridContainer.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; color: #667eea;"></i><p style="margin-top: 1rem; color: #64748b;">Loading transaction details...</p></div>';

        const currentInstance = localStorage.getItem('fusionInstance') || 'PROD';
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/s2vdetails/${orderNumber}`;

        // Log debug info
        logDebugInfo('Refresh Transaction Details', apiUrl, { orderNumber, instance: currentInstance }, null, null, 'GET');

        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            console.log('[Store Transactions] Callback - Error:', error, 'Data:', data);

            // Log response or error
            if (error) {
                logDebugInfo('Refresh Transaction Details - Error', apiUrl, null, null, error, 'GET');
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error: ${error}</p>`;
                return;
            } else {
                logDebugInfo('Refresh Transaction Details - Success', apiUrl, null, data, null, 'GET');
            }

            try {
                const response = JSON.parse(data);
                console.log('[Store Transactions] Parsed Response:', response);

                if (response && response.items && response.items.length > 0) {
                    // Clear loading message
                    gridContainer.innerHTML = '';

                    // Destroy existing grid if present
                    if (transactionDetailsGrid) {
                        try {
                            transactionDetailsGrid.dispose();
                        } catch (e) {
                            console.warn('[Store Transactions] Error disposing grid:', e);
                        }
                    }

                    // Get keys from first item to create columns dynamically
                    const keys = Object.keys(response.items[0]);
                    const columns = keys.map(key => ({
                        dataField: key,
                        caption: key.replace(/_/g, ' ').toUpperCase(),
                        width: 'auto'
                    }));

                    // Initialize DevExpress DataGrid
                    transactionDetailsGrid = $('#transaction-details-grid').dxDataGrid({
                        dataSource: response.items,
                        showBorders: true,
                        showRowLines: true,
                        showColumnLines: true,
                        rowAlternationEnabled: true,
                        columnAutoWidth: true,
                        allowColumnReordering: true,
                        allowColumnResizing: true,
                        wordWrapEnabled: false,
                        hoverStateEnabled: true,
                        columns: columns,
                        paging: {
                            pageSize: 20
                        },
                        pager: {
                            visible: true,
                            showPageSizeSelector: true,
                            allowedPageSizes: [10, 20, 50, 100],
                            showInfo: true,
                            showNavigationButtons: true
                        },
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
                        columnChooser: {
                            enabled: true,
                            mode: 'select'
                        },
                        export: {
                            enabled: true,
                            allowExportSelectedData: false
                        },
                        onExporting: function(e) {
                            const workbook = new ExcelJS.Workbook();
                            const worksheet = workbook.addWorksheet('Transaction Details');

                            DevExpress.excelExporter.exportDataGrid({
                                component: e.component,
                                worksheet: worksheet,
                                autoFilterEnabled: true
                            }).then(function() {
                                workbook.xlsx.writeBuffer().then(function(buffer) {
                                    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'TransactionDetails.xlsx');
                                });
                            });
                            e.cancel = true;
                        },
                        onContentReady: function(e) {
                            console.log('[Store Transactions] Transaction Details Grid loaded, row count:', e.component.totalCount());
                        }
                    }).dxDataGrid('instance');

                    // Show Fetch Lot Details button
                    document.getElementById('fetch-lot-btn').style.display = 'inline-flex';
                } else {
                    gridContainer.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 2rem;">No data found for this order</p>';
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error parsing data: ${parseError.message}</p>`;
            }
        });
    };


    window.fetchLotDetails = function(orderNumber) {
        console.log('[Store Transactions] Fetching lot details for:', orderNumber);

        // Show confirmation dialog
        if (!confirm(`Are you sure you want to fetch lot details for transaction ${orderNumber}?`)) {
            console.log('[Store Transactions] Fetch lot details cancelled by user');
            return;
        }

        // Get fusion instance from localStorage
        const fusionInstance = localStorage.getItem('fusionInstance') || 'TEST';

        // Show loading state
        const fetchBtn = document.getElementById('fetch-lot-btn');
        if (fetchBtn) {
            fetchBtn.disabled = true;
            fetchBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Fetching...';
        }

        // Prepare POST data
        const postData = {
            p_trx_number: orderNumber,
            p_instance_name: fusionInstance
        };

        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fetchlotdetails';

        console.log('[Store Transactions] Calling fetch lot details API:', apiUrl, postData);

        // Log debug info
        logDebugInfo('Fetch Lot Details', apiUrl, postData, null, null, 'POST');

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            body: JSON.stringify(postData)
        }, function(error, data) {
            console.log('[Store Transactions] Fetch Lot Details Response - Error:', error, 'Data:', data);

            // Log response or error
            if (error) {
                logDebugInfo('Fetch Lot Details - Error', apiUrl, postData, null, error, 'POST');
            } else {
                try {
                    const response = JSON.parse(data);
                    logDebugInfo('Fetch Lot Details - Success', apiUrl, postData, response, null, 'POST');
                } catch (e) {
                    logDebugInfo('Fetch Lot Details - Success', apiUrl, postData, data, null, 'POST');
                }
            }

            // Re-enable button
            if (fetchBtn) {
                fetchBtn.disabled = false;
                fetchBtn.innerHTML = '<i class="fas fa-list"></i> Fetch Lot Details';
            }

            if (error) {
                alert('Error fetching lot details: ' + error);
                return;
            }

            try {
                const response = JSON.parse(data);
                console.log('[Store Transactions] Parsed response:', response);

                if (response.success) {
                    const recordCount = response.recordCount || 0;
                    const countMsg = recordCount > 0 ? ` - ${recordCount} record(s) processed` : '';
                    alert('Success: ' + (response.message || 'Lot details fetched successfully') + countMsg);

                    // Refresh the transaction details to show updated data
                    refreshTransactionDetails(orderNumber);
                } else {
                    alert('Failed: ' + (response.message || 'Unknown error occurred'));
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                alert('Error parsing response: ' + parseError.message);
            }
        });
    };

    // Refresh Allocated Lots (Tab 3)
    window.refreshAllocatedLots = async function(orderNumber) {
        console.log('[Store Transactions] Refreshing allocated lots for:', orderNumber);

        const gridContainer = document.getElementById('allocated-lots-grid');
        if (!gridContainer) {
            console.error('[Store Transactions] Allocated Lots Grid container not found');
            return;
        }

        // Show loading indicator
        gridContainer.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; color: #667eea;"></i><p style="margin-top: 1rem; color: #64748b;">Loading allocated lots...</p></div>';

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fetchlotdetails?v_trx_number=${orderNumber}`;

        // Log debug info
        logDebugInfo('Refresh Allocated Lots', apiUrl, { orderNumber }, null, null, 'GET');

        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            console.log('[Store Transactions] Allocated Lots Callback - Error:', error, 'Data:', data);

            // Log response or error
            if (error) {
                logDebugInfo('Refresh Allocated Lots - Error', apiUrl, null, null, error, 'GET');
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error: ${error}</p>`;
                return;
            } else {
                try {
                    const response = JSON.parse(data);
                    logDebugInfo('Refresh Allocated Lots - Success', apiUrl, null, response, null, 'GET');
                } catch (e) {
                    logDebugInfo('Refresh Allocated Lots - Success', apiUrl, null, data, null, 'GET');
                }
            }

            try {
                const response = JSON.parse(data);

                if (response && response.items && response.items.length > 0) {
                    // Store items globally for access when setting data
                    window.allocatedLotsData = response.items;

                    // Debug: Log first item structure
                    console.log('[Store Transactions] Allocated Lots - First item:', response.items[0]);
                    console.log('[Store Transactions] Allocated Lots - Total items:', response.items.length);

                    // Clear loading message
                    gridContainer.innerHTML = '';

                    // Destroy existing grid if present
                    if (allocatedLotsGrid) {
                        try {
                            allocatedLotsGrid.dispose();
                        } catch (e) {
                            console.warn('[Store Transactions] Error disposing Allocated Lots grid:', e);
                        }
                    }

                    // Helper function to check if column is status
                    const isStatusColumn = (key) => {
                        const lowerKey = key.toLowerCase();
                        const upperKey = key.toUpperCase();
                        return lowerKey.includes('status') ||
                            lowerKey.includes('_st') ||
                            upperKey === 'PICKED_ST' ||
                            upperKey === 'CANCELED_ST' ||
                            upperKey === 'SHIPED_ST' ||
                            lowerKey === 'picked_status' ||
                            lowerKey === 'canceled_status' ||
                            lowerKey === 'ship_confirm_st';
                    };

                    // Get keys from first item to create columns dynamically
                    const keys = Object.keys(response.items[0]);
                    console.log('[Store Transactions] Allocated Lots - Column keys:', keys);

                    const columns = keys.map(key => {
                        const column = {
                            dataField: key,
                            caption: key.replace(/_/g, ' ').toUpperCase(),
                            width: 'auto',
                            allowFiltering: true,
                            allowSorting: true
                        };

                        // Add custom cell template for status columns
                        if (isStatusColumn(key)) {
                            console.log('[Store Transactions] Status column detected:', key);
                            column.cellTemplate = function(container, options) {
                                const value = options.value;
                                console.log('[Store Transactions] Rendering status cell:', key, '=', value);
                                let icon = '';
                                if (value === 'Y' || value === 'Yes' || value === 'YES') {
                                    icon = '<i class="fas fa-check-circle" style="color: #10b981; font-size: 0.9rem;" title="Yes"></i>';
                                } else {
                                    // Show red X for NO, null, or empty values
                                    icon = '<i class="fas fa-times-circle" style="color: #ef4444; font-size: 0.9rem;" title="No"></i>';
                                }
                                container.innerHTML = `<div style="text-align: center;">${icon}</div>`;
                            };
                        } else {
                            // For non-status columns, use default rendering but log values
                            column.cellTemplate = function(container, options) {
                                const value = options.value;
                                console.log('[Store Transactions] Rendering cell:', key, '=', value);
                                container.textContent = (value !== null && value !== undefined) ? value : '';
                            };
                        }

                        return column;
                    });

                    // Initialize DevExpress DataGrid with selection
                    allocatedLotsGrid = $('#allocated-lots-grid').dxDataGrid({
                        dataSource: response.items,
                        showBorders: true,
                        showRowLines: true,
                        showColumnLines: true,
                        rowAlternationEnabled: true,
                        columnAutoWidth: true,
                        allowColumnReordering: true,
                        allowColumnResizing: true,
                        wordWrapEnabled: false,
                        hoverStateEnabled: true,
                        selection: {
                            mode: 'multiple',
                            showCheckBoxesMode: 'always'
                        },
                        columns: columns,
                        paging: {
                            pageSize: 20
                        },
                        pager: {
                            visible: true,
                            showPageSizeSelector: true,
                            allowedPageSizes: [10, 20, 50, 100],
                            showInfo: true,
                            showNavigationButtons: true
                        },
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
                        columnChooser: {
                            enabled: true,
                            mode: 'select'
                        },
                        export: {
                            enabled: true,
                            allowExportSelectedData: true
                        },
                        onExporting: function(e) {
                            const workbook = new ExcelJS.Workbook();
                            const worksheet = workbook.addWorksheet('Allocated Lots');

                            DevExpress.excelExporter.exportDataGrid({
                                component: e.component,
                                worksheet: worksheet,
                                autoFilterEnabled: true
                            }).then(function() {
                                workbook.xlsx.writeBuffer().then(function(buffer) {
                                    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'AllocatedLots.xlsx');
                                });
                            });
                            e.cancel = true;
                        },
                        onSelectionChanged: function(e) {
                            const selectedCount = e.selectedRowsData.length;
                            console.log('[Store Transactions] Selected rows:', selectedCount);
                        },
                        onContentReady: function(e) {
                            console.log('[Store Transactions] Allocated Lots Grid loaded, row count:', e.component.totalCount());
                        }
                    }).dxDataGrid('instance');
                } else {
                    gridContainer.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 2rem;">No allocated lots found for this order</p>';
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error parsing data: ${parseError.message}</p>`;
            }
        });
    };


    // Refresh QOH Details (Tab 2)
    window.refreshQOHDetails = async function(orderNumber) {
        console.log('[Store Transactions] Refreshing QOH details for:', orderNumber);

        const gridContainer = document.getElementById('qoh-details-grid');
        if (!gridContainer) {
            console.error('[Store Transactions] QOH Grid container not found');
            return;
        }

        // Show loading indicator
        gridContainer.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; color: #667eea;"></i><p style="margin-top: 1rem; color: #64748b;">Loading QOH details...</p></div>';

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/tripqoh?v_trx_number=${orderNumber}`;

        // Log debug info
        logDebugInfo('Refresh QOH Details', apiUrl, { orderNumber }, null, null, 'GET');

        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            console.log('[Store Transactions] QOH Details Callback - Error:', error, 'Data:', data);

            // Log response or error
            if (error) {
                logDebugInfo('Refresh QOH Details - Error', apiUrl, null, null, error, 'GET');
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error: ${error}</p>`;
                return;
            } else {
                try {
                    const response = JSON.parse(data);
                    logDebugInfo('Refresh QOH Details - Success', apiUrl, null, response, null, 'GET');
                } catch (e) {
                    logDebugInfo('Refresh QOH Details - Success', apiUrl, null, data, null, 'GET');
                }
            }

            try {
                const response = JSON.parse(data);

                if (response && response.items && response.items.length > 0) {
                    // Store QOH data globally for lot number lookup
                    window.qohData = response.items;

                    // Clear loading message
                    gridContainer.innerHTML = '';

                    // Destroy existing grid if present
                    if (qohDetailsGrid) {
                        try {
                            qohDetailsGrid.dispose();
                        } catch (e) {
                            console.warn('[Store Transactions] Error disposing QOH grid:', e);
                        }
                    }

                    // Get keys from first item to create columns dynamically
                    const keys = Object.keys(response.items[0]);
                    const columns = keys.map(key => ({
                        dataField: key,
                        caption: key.replace(/_/g, ' ').toUpperCase(),
                        width: 'auto'
                    }));

                    // Initialize DevExpress DataGrid
                    qohDetailsGrid = $('#qoh-details-grid').dxDataGrid({
                        dataSource: response.items,
                        showBorders: true,
                        showRowLines: true,
                        showColumnLines: true,
                        rowAlternationEnabled: true,
                        columnAutoWidth: true,
                        allowColumnReordering: true,
                        allowColumnResizing: true,
                        wordWrapEnabled: false,
                        hoverStateEnabled: true,
                        columns: columns,
                        paging: {
                            pageSize: 20
                        },
                        pager: {
                            visible: true,
                            showPageSizeSelector: true,
                            allowedPageSizes: [10, 20, 50, 100],
                            showInfo: true,
                            showNavigationButtons: true
                        },
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
                        columnChooser: {
                            enabled: true,
                            mode: 'select'
                        },
                        export: {
                            enabled: true,
                            allowExportSelectedData: false
                        },
                        onExporting: function(e) {
                            const workbook = new ExcelJS.Workbook();
                            const worksheet = workbook.addWorksheet('QOH Details');

                            DevExpress.excelExporter.exportDataGrid({
                                component: e.component,
                                worksheet: worksheet,
                                autoFilterEnabled: true
                            }).then(function() {
                                workbook.xlsx.writeBuffer().then(function(buffer) {
                                    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'QOHDetails.xlsx');
                                });
                            });
                            e.cancel = true;
                        },
                        onContentReady: function(e) {
                            console.log('[Store Transactions] QOH Details Grid loaded, row count:', e.component.totalCount());
                        }
                    }).dxDataGrid('instance');
                } else {
                    gridContainer.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 2rem;">No QOH data found for this order</p>';
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error parsing data: ${parseError.message}</p>`;
            }
        });
    };


    // Get selected rows from Allocated Lots grid (for use in setData and other functions)
    window.getSelectedAllocatedLots = function() {
        if (allocatedLotsGrid) {
            return allocatedLotsGrid.getSelectedRowsData();
        }
        return [];
    };

    window.processTransaction = function(orderNumber) {
        console.log('[Store Transactions] Processing transaction for:', orderNumber);

        // Show confirmation dialog
        if (!confirm(`Are you sure you want to process transaction ${orderNumber}?`)) {
            console.log('[Store Transactions] Process transaction cancelled by user');
            return;
        }

        // Get fusion instance from localStorage
        const fusionInstance = localStorage.getItem('fusionInstance') || 'TEST';

        // Prepare POST data
        const postData = {
            p_trx_number: orderNumber,
            p_instance_name: fusionInstance
        };

        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/processs2v';

        console.log('[Store Transactions] Calling process transaction API:', apiUrl, postData);

        // Log debug info
        logDebugInfo('Process Transaction', apiUrl, postData, null, null, 'POST');

        // Show loading dialog
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'process-transaction-loading';
        loadingDiv.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10002; display: flex; align-items: center; justify-content: center;';
        loadingDiv.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); text-align: center;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: #667eea; margin-bottom: 1rem;"></i>
                <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">Processing Transaction...</div>
                <div style="font-size: 0.9rem; color: #64748b; margin-top: 0.5rem;">Order: ${orderNumber}</div>
                <div style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Instance: ${fusionInstance}</div>
            </div>
        `;
        document.body.appendChild(loadingDiv);

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            body: JSON.stringify(postData)
        }, function(error, data) {
            console.log('[Store Transactions] Process Transaction Response - Error:', error, 'Data:', data);

            // Remove loading dialog
            const loading = document.getElementById('process-transaction-loading');
            if (loading) loading.remove();

            // Log response or error
            if (error) {
                logDebugInfo('Process Transaction - Error', apiUrl, postData, null, error, 'POST');
                alert('Error processing transaction: ' + error);
                return;
            }

            try {
                const response = JSON.parse(data);
                logDebugInfo('Process Transaction - Success', apiUrl, postData, response, null, 'POST');

                console.log('[Store Transactions] Parsed response:', response);

                if (response.success) {
                    alert('Success: ' + (response.message || 'Transaction processed successfully'));

                    // Refresh the transaction details and allocated lots to show updated data
                    refreshTransactionDetails(orderNumber);
                    refreshAllocatedLots(orderNumber);
                } else {
                    alert('Failed: ' + (response.message || 'Unknown error occurred'));
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                logDebugInfo('Process Transaction - Success', apiUrl, postData, data, null, 'POST');
                alert('Transaction response: ' + data);
            }
        });
    };

    window.setData = function(orderNumber) {
        console.log('[Store Transactions] Set data for:', orderNumber);

        // Get selected rows from DevExpress grid
        const selectedItems = getSelectedAllocatedLots();

        if (selectedItems.length === 0) {
            alert('Please select at least one record to set data');
            return;
        }

        console.log('[Store Transactions] Selected items:', selectedItems);

        // Open Set Data dialog
        openSetDataDialog(orderNumber, selectedItems);
    };

    // Open Set Data Dialog
    function openSetDataDialog(orderNumber, selectedItems) {
        const isSingleSelection = selectedItems.length === 1;
        let modalHtml = '';

        if (isSingleSelection) {
            // Single selection mode - Form with input + datalist
            const item = selectedItems[0];
            const itemNumber = item.ITEM_NUMBER || item.item_number || item.ITEM || item.item || item.itemnumber || item.ITEMNUMBER || '';
            const itemDescription = item.ITEM_DESCRIPTION || item.item_description || item.DESCRIPTION || item.description || item.DESC || item.desc || '';

            console.log('[Set Data] Single selection - Item:', itemNumber);
            console.log('[Set Data] Single selection - Full item data:', item);

            // Get available lots for this item from QOH data
            const availableLots = window.qohData ? window.qohData.filter(qoh => {
                // QOH uses ITEMNUMBER (no underscore)
                const qohItem = qoh.ITEMNUMBER || qoh.itemnumber || qoh.ITEM_NUMBER || qoh.item_number || qoh.ITEM || qoh.item || '';
                const match = qohItem === itemNumber || qohItem.trim() === itemNumber.trim();
                if (match) {
                    console.log('[Set Data] Matched QOH item:', qohItem, 'with allocated item:', itemNumber);
                }
                return match;
            }) : [];

            console.log('[Set Data] Single selection - Found', availableLots.length, 'lots:', availableLots);
            if (window.qohData && window.qohData.length > 0) {
                console.log('[Set Data] Sample QOH record:', window.qohData[0]);
            }

            // Get allocated quantity from item
            const allocatedQty = item.ALLOCATED_QTY || item.allocated_qty || item.QTY || item.qty || item.QUANTITY || item.quantity || '';

            // Build datalist options with quantity
            let lotDatalistOptions = '';
            const singleLotExpirationMap = {};
            availableLots.forEach(lot => {
                const lotNum = lot.LOT_NUMBER || lot.lot_number || lot.LOT || lot.lot || '';
                const lotExp = lot.LOT_EXPIRATION_DATE || lot.lot_expiration_date || lot.EXPIRATION_DATE || lot.expiration_date || lot.EXPIRE_DATE || lot.expire_date || '';
                const lotQty = lot.primaryquantity || lot.PRIMARYQUANTITY || lot.QTY || lot.qty || lot.QUANTITY || lot.quantity || lot.QOH || lot.qoh || '';
                if (lotNum) {
                    // Show lot number with quantity in dropdown
                    lotDatalistOptions += `<option value="${lotNum}" label="Lot: ${lotNum} | Qty: ${lotQty}">`;
                    singleLotExpirationMap[lotNum] = lotExp;
                }
            });

            // Store expiration map globally
            window.singleLotExpirationMap = singleLotExpirationMap;

            modalHtml = `
                <div id="set-data-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; justify-content: center; align-items: center;">
                    <div style="background: white; width: 90%; max-width: 600px; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                        <div style="padding: 1rem 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                            <h3 style="margin: 0; color: white; font-size: 1.1rem;">
                                <i class="fas fa-edit"></i> Set Data for Item
                            </h3>
                            <p style="margin: 0.5rem 0 0 0; color: rgba(255,255,255,0.9); font-size: 0.8rem; line-height: 1.5;">
                                <strong>Item:</strong> ${itemNumber}<br>
                                ${itemDescription ? `<span style="font-size: 0.75rem; opacity: 0.9;">${itemDescription}</span><br>` : ''}
                                <span style="font-size: 0.75rem;">${availableLots.length} lot(s) available</span>
                            </p>
                        </div>

                        <div style="padding: 1.5rem; overflow-y: auto; max-height: 60vh;">
                            <form id="set-data-form" style="display: grid; gap: 1rem;">
                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Lot Number
                                    </label>
                                    <input type="text" list="single-lot-datalist" id="set-lot-number"
                                        onchange="onLotNumberChangeInput()" oninput="onLotNumberChangeInput()"
                                        placeholder="Type or select lot number"
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;">
                                    <datalist id="single-lot-datalist">
                                        ${lotDatalistOptions}
                                    </datalist>
                                </div>

                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Lot Expiration Date
                                    </label>
                                    <input type="date" id="set-lot-exp-date" readonly
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem; background: #f8f9fc;">
                                </div>

                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Picked Qty
                                    </label>
                                    <input type="number" id="set-picked-qty" step="0.01" value="${allocatedQty}"
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;"
                                        placeholder="Enter picked quantity">
                                </div>

                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Ship Confirm Status
                                    </label>
                                    <select id="set-ship-confirm-status"
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;">
                                        <option value="">-- Select --</option>
                                        <option value="YES">YES</option>
                                        <option value="NO">NO</option>
                                    </select>
                                </div>

                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Pick Confirm Status
                                    </label>
                                    <select id="set-pick-confirm-status"
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;">
                                        <option value="">-- Select --</option>
                                        <option value="YES">YES</option>
                                        <option value="NO">NO</option>
                                    </select>
                                </div>

                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Cancelled Status
                                    </label>
                                    <select id="set-cancelled-status"
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;">
                                        <option value="">-- Select --</option>
                                        <option value="YES">YES</option>
                                        <option value="NO">NO</option>
                                    </select>
                                </div>
                            </form>
                        </div>

                        <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; background: #f8f9fc; display: flex; gap: 0.75rem; justify-content: flex-end;">
                            <button class="btn btn-secondary" onclick="closeSetDataDialog()">
                                <i class="fas fa-times"></i> Cancel
                            </button>
                            <button class="btn btn-primary" onclick="submitSetData('${orderNumber}', ${JSON.stringify(selectedItems).replace(/"/g, '&quot;')})">
                                <i class="fas fa-save"></i> Set Data
                            </button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Multiple selection mode - Grid view
            let gridRows = '';
            selectedItems.forEach((item, index) => {
                const itemNumber = item.ITEM_NUMBER || item.item_number || item.ITEM || item.item || item.itemnumber || item.ITEMNUMBER || '';
                const itemDescription = item.ITEM_DESCRIPTION || item.item_description || item.DESCRIPTION || item.description || item.DESC || item.desc || '';
                const lineNumber = item.LINE_NUMBER || item.line_number || item.LINE || item.line || index + 1;

                console.log(`[Set Data] Row ${index} - Item: ${itemNumber}`);
                console.log(`[Set Data] Row ${index} - Full item data:`, item);

                // Get available lots for this item
                const availableLots = window.qohData ? window.qohData.filter(qoh => {
                    // QOH uses ITEMNUMBER (no underscore)
                    const qohItem = qoh.ITEMNUMBER || qoh.itemnumber || qoh.ITEM_NUMBER || qoh.item_number || qoh.ITEM || qoh.item || '';
                    const match = qohItem === itemNumber || qohItem.trim() === itemNumber.trim();
                    if (match) {
                        console.log(`[Set Data] Row ${index} - Matched QOH item: ${qohItem} with allocated item: ${itemNumber}`);
                    }
                    return match;
                }) : [];

                console.log(`[Set Data] Row ${index} - Found ${availableLots.length} lots:`, availableLots);
                if (index === 0 && window.qohData && window.qohData.length > 0) {
                    console.log('[Set Data] Sample QOH record:', window.qohData[0]);
                }

                // Get allocated quantity from item
                const allocatedQty = item.ALLOCATED_QTY || item.allocated_qty || item.QTY || item.qty || item.QUANTITY || item.quantity || '';

                // Build datalist options for autocomplete with quantity
                let lotDatalistId = `lot-datalist-${index}`;
                let lotDatalistOptions = '';
                const lotExpirationMap = {};

                availableLots.forEach(lot => {
                    const lotNum = lot.LOT_NUMBER || lot.lot_number || lot.LOT || lot.lot || '';
                    const lotExp = lot.LOT_EXPIRATION_DATE || lot.lot_expiration_date || lot.EXPIRATION_DATE || lot.expiration_date || lot.EXPIRE_DATE || lot.expire_date || '';
                    const lotQty = lot.primaryquantity || lot.PRIMARYQUANTITY || lot.QTY || lot.qty || lot.QUANTITY || lot.quantity || lot.QOH || lot.qoh || '';
                    if (lotNum) {
                        // Show lot number with quantity in dropdown
                        lotDatalistOptions += `<option value="${lotNum}" label="Lot: ${lotNum} | Qty: ${lotQty}">`;
                        lotExpirationMap[lotNum] = lotExp;
                    }
                });

                // Store expiration map globally for this row
                if (!window.lotExpirationMaps) window.lotExpirationMaps = {};
                window.lotExpirationMaps[index] = lotExpirationMap;

                gridRows += `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 0.5rem; font-size: 0.75rem; white-space: nowrap;">${lineNumber}</td>
                        <td style="padding: 0.5rem; font-size: 0.75rem;">
                            <div style="font-weight: 500;">${itemNumber}</div>
                            ${itemDescription ? `<div style="font-size: 0.65rem; color: #64748b; margin-top: 0.2rem; line-height: 1.2;">${itemDescription}</div>` : ''}
                        </td>
                        <td style="padding: 0.5rem;">
                            <input type="text" list="${lotDatalistId}" class="grid-lot-number" data-row="${index}"
                                onchange="onGridLotChangeInput(${index})" oninput="onGridLotChangeInput(${index})"
                                placeholder="Type or select lot"
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem;">
                            <datalist id="${lotDatalistId}">
                                ${lotDatalistOptions}
                            </datalist>
                            <small style="color: #64748b; font-size: 0.65rem;">${availableLots.length} lot(s) available</small>
                        </td>
                        <td style="padding: 0.5rem;">
                            <input type="date" class="grid-lot-exp" data-row="${index}" readonly
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem; background: #f8f9fc;">
                        </td>
                        <td style="padding: 0.5rem;">
                            <input type="number" class="grid-picked-qty" data-row="${index}" step="0.01" value="${allocatedQty}"
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem;">
                        </td>
                        <td style="padding: 0.5rem;">
                            <select class="grid-ship-status" data-row="${index}"
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem;">
                                <option value="">--</option>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                            </select>
                        </td>
                        <td style="padding: 0.5rem;">
                            <select class="grid-pick-status" data-row="${index}"
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem;">
                                <option value="">--</option>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                            </select>
                        </td>
                        <td style="padding: 0.5rem;">
                            <select class="grid-cancel-status" data-row="${index}"
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem;">
                                <option value="">--</option>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                            </select>
                        </td>
                    </tr>
                `;
            });

            modalHtml = `
                <div id="set-data-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; justify-content: center; align-items: center;">
                    <div style="background: white; width: 95%; max-width: 1200px; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                        <div style="padding: 1rem 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                            <h3 style="margin: 0; color: white; font-size: 1.1rem;">
                                <i class="fas fa-edit"></i> Set Data for Multiple Records
                            </h3>
                            <p style="margin: 0.5rem 0 0 0; color: rgba(255,255,255,0.9); font-size: 0.8rem;">
                                ${selectedItems.length} records selected
                            </p>
                        </div>

                        <div style="padding: 1rem; overflow-y: auto; max-height: 70vh;">
                            <div style="overflow-x: auto;">
                                <table style="width: 100%; border-collapse: collapse;">
                                    <thead style="position: sticky; top: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); z-index: 10;">
                                        <tr>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Line</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Item Number</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Lot Number</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Lot Exp Date</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Picked Qty</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Ship Confirm</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Pick Confirm</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Cancelled</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${gridRows}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; background: #f8f9fc; display: flex; gap: 0.75rem; justify-content: flex-end;">
                            <button class="btn btn-secondary" onclick="closeSetDataDialog()">
                                <i class="fas fa-times"></i> Cancel
                            </button>
                            <button class="btn btn-primary" onclick="submitSetDataGrid('${orderNumber}', ${JSON.stringify(selectedItems).replace(/"/g, '&quot;')})">
                                <i class="fas fa-save"></i> Set Data
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        // Remove existing modal if any
        const existingModal = document.getElementById('set-data-modal');
        if (existingModal) {
            existingModal.remove();
        }

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    window.closeSetDataDialog = function() {
        const modal = document.getElementById('set-data-modal');
        if (modal) {
            modal.remove();
        }
    };

    window.submitSetData = function(orderNumber, selectedItems) {
        console.log('[Store Transactions] Submitting set data for:', orderNumber, selectedItems);

        // Get form values
        const lotNumber = document.getElementById('set-lot-number').value.trim();
        const lotExpDate = document.getElementById('set-lot-exp-date').value;
        const pickedQty = document.getElementById('set-picked-qty').value;
        const shipConfirmStatus = document.getElementById('set-ship-confirm-status').value;
        const pickConfirmStatus = document.getElementById('set-pick-confirm-status').value;
        const cancelledStatus = document.getElementById('set-cancelled-status').value;

        // Validate at least one field is filled
        if (!lotNumber && !lotExpDate && !pickedQty && !shipConfirmStatus && !pickConfirmStatus && !cancelledStatus) {
            alert('Please fill at least one field to update');
            return;
        }

        // Prepare POST data (structure will be provided by user)
        const postData = {
            order_number: orderNumber,
            selected_items: selectedItems,
            updates: {
                lot_number: lotNumber || null,
                lot_expiration_date: lotExpDate || null,
                picked_qty: pickedQty ? parseFloat(pickedQty) : null,
                ship_confirm_status: shipConfirmStatus || null,
                pick_confirm_status: pickConfirmStatus || null,
                cancelled_status: cancelledStatus || null
            }
        };

        console.log('[Store Transactions] POST data:', postData);

        // TODO: User will provide POST endpoint
        alert('Set Data POST endpoint will be integrated here.\n\nData prepared:\n' + JSON.stringify(postData, null, 2));

        // Close dialog
        closeSetDataDialog();
    };

    // Handle lot number change for single selection (input field with datalist)
    window.onLotNumberChangeInput = function() {
        const lotInput = document.getElementById('set-lot-number');
        const expDateInput = document.getElementById('set-lot-exp-date');

        const lotNumber = lotInput.value.trim();

        // Check if this lot number has an expiration date in our map
        if (window.singleLotExpirationMap && window.singleLotExpirationMap[lotNumber]) {
            const expiration = window.singleLotExpirationMap[lotNumber];
            if (expiration) {
                const formattedDate = expiration.split('T')[0]; // Handle ISO date format
                expDateInput.value = formattedDate;
            } else {
                expDateInput.value = '';
            }
        } else {
            expDateInput.value = '';
        }
    };

    // Keep old function for backward compatibility
    window.onLotNumberChange = function() {
        onLotNumberChangeInput();
    };

    // Handle lot number change for grid rows (input field with datalist)
    window.onGridLotChangeInput = function(rowIndex) {
        const lotInput = document.querySelector(`.grid-lot-number[data-row="${rowIndex}"]`);
        const expDateInput = document.querySelector(`.grid-lot-exp[data-row="${rowIndex}"]`);

        const lotNumber = lotInput.value.trim();

        // Check if this lot number has an expiration date in our map
        if (window.lotExpirationMaps && window.lotExpirationMaps[rowIndex]) {
            const expiration = window.lotExpirationMaps[rowIndex][lotNumber];
            if (expiration) {
                const formattedDate = expiration.split('T')[0];
                expDateInput.value = formattedDate;
            } else {
                expDateInput.value = '';
            }
        } else {
            expDateInput.value = '';
        }
    };

    // Keep old function for backward compatibility
    window.onGridLotChange = function(rowIndex) {
        onGridLotChangeInput(rowIndex);
    };

    // Submit grid data for multiple selections
    window.submitSetDataGrid = function(orderNumber, selectedItems) {
        console.log('[Store Transactions] Submitting grid set data for:', orderNumber);

        // Collect data from grid
        const gridData = [];
        selectedItems.forEach((item, index) => {
            const lotNumber = document.querySelector(`.grid-lot-number[data-row="${index}"]`).value;
            const lotExpDate = document.querySelector(`.grid-lot-exp[data-row="${index}"]`).value;
            const pickedQty = document.querySelector(`.grid-picked-qty[data-row="${index}"]`).value;
            const shipStatus = document.querySelector(`.grid-ship-status[data-row="${index}"]`).value;
            const pickStatus = document.querySelector(`.grid-pick-status[data-row="${index}"]`).value;
            const cancelStatus = document.querySelector(`.grid-cancel-status[data-row="${index}"]`).value;

            gridData.push({
                item_data: item,
                updates: {
                    lot_number: lotNumber || null,
                    lot_expiration_date: lotExpDate || null,
                    picked_qty: pickedQty ? parseFloat(pickedQty) : null,
                    ship_confirm_status: shipStatus || null,
                    pick_confirm_status: pickStatus || null,
                    cancelled_status: cancelStatus || null
                }
            });
        });

        // Prepare POST data
        const postData = {
            order_number: orderNumber,
            records: gridData
        };

        console.log('[Store Transactions] Grid POST data:', postData);

        // TODO: User will provide POST endpoint
        alert('Set Data POST endpoint will be integrated here.\n\nData prepared:\n' + JSON.stringify(postData, null, 2));

        // Close dialog
        closeSetDataDialog();
    };

    window.checkFusionStatus = function(orderNumber) {
        console.log('[Store Transactions] Check fusion status for:', orderNumber);
        alert('Check Fusion Status functionality - To be implemented');
    };

    window.deleteTripOrder = function(tripId, orderNumber) {
        console.log('[Trip Management] Delete order:', orderNumber);
        alert('Delete Order functionality - To be implemented');
    };

    function activateTripTab(tabId) {
        document.querySelectorAll('#trip-tab-header .tab-item').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#trip-tab-content .tab-pane').forEach(p => p.classList.remove('active'));
        
        const tabItem = document.querySelector(`.tab-item[data-tab="${tabId}"]`);
        const tabPane = document.getElementById(`trip-${tabId}-tab`);
        
        if (tabItem) tabItem.classList.add('active');
        if (tabPane) tabPane.classList.add('active');
    }

    // Initialize vehicles page
    function initVehiclesPage() {
        if (currentFullData.length > 0) {
            currentVehiclesData = [...currentFullData];
            updateVehiclesFilterDropdown();
            setupVehiclesDateFilters();
            processVehiclesSummary(currentVehiclesData);
            showDebugData(currentFullData);
        }
        
        document.getElementById('vehicles-vehicle-filter').addEventListener('change', applyVehiclesFilters);
        document.getElementById('merge-dates-checkbox').addEventListener('change', function() {
            applyVehiclesFilters();
        });
        
        document.querySelectorAll('#vehicles-tab-header .tab-item').forEach(tab => {
            tab.addEventListener('click', function() {
                const tabName = this.dataset.tab;
                if (!tabName) return;
                
                document.querySelectorAll('#vehicles-tab-header .tab-item').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('#vehicles-tab-content .tab-pane').forEach(p => p.classList.remove('active'));
                this.classList.add('active');
                document.getElementById(`vehicles-${tabName}-tab`).classList.add('active');
            });
        });
    }

    function setupVehiclesDateFilters() {
        const uniqueDates = new Set();
        currentFullData.forEach(trip => {
            let date = null;
            for (let key in trip) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'order_date' || lowerKey === 'orderdate' || 
                    lowerKey === 'shipment_date' || lowerKey === 'shipmentdate' ||
                    lowerKey === 'trip_date' || lowerKey === 'tripdate') {
                    date = trip[key];
                    break;
                }
            }
            if (date) {
                const dateKey = String(date).split(' ')[0];
                if (dateKey) uniqueDates.add(dateKey);
            }
        });
        
        const dateArray = Array.from(uniqueDates).sort();
        const dateFiltersContainer = document.getElementById('vehicles-date-filters');
        
        if (dateArray.length > 0) {
            dateFiltersContainer.innerHTML = dateArray.map(date => 
                `<span class="filter-chip" data-date="${date}">${date}</span>`
            ).join('');
            
            dateFiltersContainer.querySelectorAll('.filter-chip').forEach(chip => {
                chip.addEventListener('click', function() {
                    this.classList.toggle('active');
                    applyVehiclesFilters();
                });
            });
        } else {
            dateFiltersContainer.innerHTML = '<span style="color: var(--gray-500); font-size: 0.85rem;">No dates available</span>';
        }
    }

    function applyVehiclesFilters() {
        const vehicleFilter = document.getElementById('vehicles-vehicle-filter').value;
        const activeDates = Array.from(document.querySelectorAll('#vehicles-date-filters .filter-chip.active'))
            .map(chip => chip.dataset.date);
        
        let filteredData = currentFullData;
        
        if (activeDates.length > 0) {
            filteredData = filteredData.filter(trip => {
                let tripDate = null;
                for (let key in trip) {
                    const lowerKey = key.toLowerCase();
                    if (lowerKey === 'order_date' || lowerKey === 'orderdate' || 
                        lowerKey === 'shipment_date' || lowerKey === 'shipmentdate' ||
                        lowerKey === 'trip_date' || lowerKey === 'tripdate') {
                        tripDate = trip[key];
                        break;
                    }
                }
                if (tripDate) {
                    const dateKey = String(tripDate).split(' ')[0];
                    return activeDates.includes(dateKey);
                }
                return false;
            });
        }
        
        if (vehicleFilter) {
            filteredData = filteredData.filter(trip => trip.trip_lorry === vehicleFilter);
        }
        
        currentVehiclesData = filteredData;
        processVehiclesSummary(filteredData);
        showDebugData(filteredData);
    }

    function updateVehiclesFilterDropdown() {
        const vehicleSet = new Set(currentFullData.map(t => t.trip_lorry).filter(x => x));
        const select = document.getElementById('vehicles-vehicle-filter');
        select.innerHTML = '<option value="">All Vehicles</option>';
        Array.from(vehicleSet).sort().forEach(vehicle => {
            const option = document.createElement('option');
            option.value = vehicle;
            option.textContent = vehicle;
            select.appendChild(option);
        });
    }

    function processVehiclesSummary(trips) {
        if (!trips || trips.length === 0) {
            document.getElementById('vehicles-cards-container').innerHTML = '<div class="loading">No vehicle data available</div>';
            return;
        }
        
        const mergeDates = document.getElementById('merge-dates-checkbox').checked;
        const vehicleMap = {};
        
        trips.forEach(trip => {
            const vid = trip.trip_lorry;
            if (!vid) return;
            
            let tripDate = null;
            for (let key in trip) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'order_date' || lowerKey === 'orderdate' || 
                    lowerKey === 'shipment_date' || lowerKey === 'shipmentdate' ||
                    lowerKey === 'trip_date' || lowerKey === 'tripdate') {
                    tripDate = trip[key];
                    break;
                }
            }
            const dateKey = tripDate ? String(tripDate).split(' ')[0] : 'Unknown';
            
            const key = mergeDates ? vid : `${vid}_${dateKey}`;
            
            if (!vehicleMap[key]) {
                vehicleMap[key] = {
                    vehicle: vid,
                    date: dateKey,
                    dates: new Set(),
                    trips: 0,
                    orders: 0,
                    customers: new Set(),
                    pickers: new Set(),
                    priority: trip.TRIP_PRIORITY || 'N/A'
                };
            }
            
            vehicleMap[key].dates.add(dateKey);
            vehicleMap[key].trips += 1;
            vehicleMap[key].orders += 1;
            if (trip.account_name) vehicleMap[key].customers.add(trip.account_name);
            if (trip.PICKER) vehicleMap[key].pickers.add(trip.PICKER);
        });
        
        const vehicleData = Object.values(vehicleMap).map(v => ({
            vehicle: v.vehicle,
            date: mergeDates ? 'Multiple' : v.date,
            dayCount: v.dates.size,
            trips: v.trips,
            orders: v.orders,
            customers: v.customers.size,
            pickers: v.pickers.size
        }));
        
        renderVehiclesCards(vehicleData, mergeDates);
    }

    function renderVehiclesCards(vehicleData, mergeDates) {
        const container = document.getElementById('vehicles-cards-container');
        let html = '';
        
        vehicleData.forEach(data => {
            const dateDisplay = data.dayCount === 1 ? data.date : 'Multiple';
            const dayText = data.dayCount === 1 ? '1 day' : `${data.dayCount} days`;
            
            html += `
            <div class="vehicle-card-new">
                <div class="vehicle-card-header">
                    <h3 class="vehicle-card-title">${data.vehicle}</h3>
                    <span class="vehicle-date-badge">Date: ${dateDisplay}</span>
                </div>
                <div class="vehicle-card-body">
                    <div class="vehicle-card-stats">
                        <div class="stat-row">
                            <span class="stat-label">Orders</span>
                            <span class="stat-value">${data.orders}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Customers</span>
                            <span class="stat-value">${data.customers}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Trips</span>
                            <span class="stat-value">${data.trips}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Pickers</span>
                            <span class="stat-value">${data.pickers}</span>
                        </div>
                    </div>
                </div>
                <div class="vehicle-card-footer">
                    <span class="vehicle-days-badge">${dayText}</span>
                    <button class="btn" onclick="alert('Vehicle: ${data.vehicle}')">
                        <i class="fas fa-folder-open"></i> Open
                    </button>
                </div>
            </div>
            `;
        });
        
        container.innerHTML = html || '<div class="loading">No vehicles found</div>';
    }

    function showDebugData(trips) {
        document.getElementById('debug-record-count').textContent = trips.length;
        
        const vehicleCount = new Set(trips.map(t => t.trip_lorry).filter(x => x)).size;
        document.getElementById('debug-vehicle-count').textContent = vehicleCount;
        
        const debugContainer = document.getElementById('debug-data-container');
        if (trips.length === 0) {
            debugContainer.innerHTML = '<div class="loading">No data available</div>';
            return;
        }
        
        let tableHTML = `
            <div style="overflow-x: auto;">
                <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--gray-100);">
                            <th style="padding: 6px; text-align: left; border: 1px solid var(--gray-200);">trip_lorry</th>
                            <th style="padding: 6px; text-align: left; border: 1px solid var(--gray-200);">account_name</th>
                            <th style="padding: 6px; text-align: left; border: 1px solid var(--gray-200);">ORDER_TYPE</th>
                            <th style="padding: 6px; text-align: left; border: 1px solid var(--gray-200);">PICKER</th>
                            <th style="padding: 6px; text-align: left; border: 1px solid var(--gray-200);">ORDER_DATE</th>
                            <th style="padding: 6px; text-align: left; border: 1px solid var(--gray-200);">LINE_STATUS</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        const sampleData = trips.slice(0, 10);
        sampleData.forEach(trip => {
            tableHTML += `
                <tr>
                    <td style="padding: 6px; border: 1px solid var(--gray-200);">${trip.trip_lorry || 'N/A'}</td>
                    <td style="padding: 6px; border: 1px solid var(--gray-200);">${trip.account_name || 'N/A'}</td>
                    <td style="padding: 6px; border: 1px solid var(--gray-200);">${trip.ORDER_TYPE || 'N/A'}</td>
                    <td style="padding: 6px; border: 1px solid var(--gray-200);">${trip.PICKER || 'N/A'}</td>
                    <td style="padding: 6px; border: 1px solid var(--gray-200);">${trip.ORDER_DATE || 'N/A'}</td>
                    <td style="padding: 6px; border: 1px solid var(--gray-200);">${trip.LINE_STATUS || 'N/A'}</td>
                </tr>
            `;
        });
        
        tableHTML += `
                    </tbody>
                </table>
                <div style="margin-top: 8px; font-size: 11px; color: #64748b;">
                    Showing ${sampleData.length} of ${trips.length} records
                </div>
            </div>
        `;
        
        debugContainer.innerHTML = tableHTML;
    }

    // ============================================
    // ANALYTICS DASHBOARD
    // ============================================

    let analyticsCharts = {
        ordersTrend: null,
        weeklyTrend: null,
        monthlyTrend: null,
        statusDist: null,
        ordersLorry: null,
        ordersPicker: null,
        topCustomers: null,
        weightLorry: null
    };

    let analyticsData = null;
    let currentFilteredData = null; // Track currently displayed filtered data

    // Initialize Analytics when trip data is loaded
    function updateAnalytics(trips) {
        if (!trips || trips.length === 0) {
            document.getElementById('analytics-dashboard').style.display = 'none';
            document.getElementById('analytics-empty-state').style.display = 'block';
            return;
        }

        analyticsData = trips;
        document.getElementById('analytics-empty-state').style.display = 'none';
        document.getElementById('analytics-dashboard').style.display = 'block';

        // Copy date filters from Trip Management to Analytics
        const tripDateFrom = document.getElementById('trip-date-from');
        const tripDateTo = document.getElementById('trip-date-to');
        const analyticsDateFrom = document.getElementById('analytics-date-from');
        const analyticsDateTo = document.getElementById('analytics-date-to');

        if (tripDateFrom && tripDateFrom.value) {
            analyticsDateFrom.value = tripDateFrom.value;
        }
        if (tripDateTo && tripDateTo.value) {
            analyticsDateTo.value = tripDateTo.value;
        }

        // If no trip dates set, use data range
        if (!analyticsDateFrom.value && !analyticsDateTo.value) {
            const dates = trips.map(t => t.trip_date || t.ORDER_DATE).filter(d => d);
            if (dates.length > 0) {
                const sortedDates = dates.sort();
                const minDate = sortedDates[0];
                const maxDate = sortedDates[sortedDates.length - 1];

                analyticsDateFrom.value = minDate;
                analyticsDateTo.value = maxDate;
            }
        }

        // Populate filter dropdowns
        populateAnalyticsFilters(trips);

        refreshAnalyticsDashboard(trips);
    }

    // Populate custom filter dropdowns
    function populateAnalyticsFilters(trips) {
        // Get unique values
        const customers = [...new Set(trips.map(t => t.account_name).filter(x => x))].sort();
        const lorries = [...new Set(trips.map(t => t.trip_lorry).filter(x => x))].sort();
        const pickers = [...new Set(trips.map(t => t.PICKER).filter(x => x))].sort();

        // Populate custom filter dropdowns
        populateCustomFilterDropdown('customers', customers);
        populateCustomFilterDropdown('lorries', lorries);
        populateCustomFilterDropdown('pickers', pickers);

        // Initialize dropdown toggle handlers
        initializeCustomFilterDropdowns();
    }

    function populateCustomFilterDropdown(filterType, items) {
        const optionsContainer = document.getElementById(`${filterType}-options`);
        optionsContainer.innerHTML = '';

        items.forEach((item, index) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'filter-option';
            optionDiv.innerHTML = `
                <input type="checkbox" id="${filterType}-${index}" value="${item}" data-filter="${filterType}">
                <label for="${filterType}-${index}">${item}</label>
            `;
            optionsContainer.appendChild(optionDiv);

            // Add click handler for the whole div
            optionDiv.addEventListener('click', function(e) {
                if (e.target.tagName !== 'INPUT') {
                    const checkbox = this.querySelector('input[type="checkbox"]');
                    checkbox.checked = !checkbox.checked;
                    updateFilterButtonText(filterType);
                    updateFilterChips();
                }
            });

            // Add change handler for checkbox
            const checkbox = optionDiv.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', function() {
                updateFilterButtonText(filterType);
                updateFilterChips();
            });
        });
    }

    function initializeCustomFilterDropdowns() {
        const filters = ['customers', 'lorries', 'pickers'];

        filters.forEach(filterType => {
            const btn = document.getElementById(`${filterType}-filter-btn`);
            const modal = document.getElementById(`${filterType}-filter-modal`);
            const searchInput = document.getElementById(`${filterType}-search`);
            const closeBtn = modal.querySelector('.filter-modal-close');
            const applyBtn = modal.querySelector('.apply-filter');
            const backdrop = modal.querySelector('.filter-modal-backdrop');

            // Open modal
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                modal.style.display = 'flex';
                setTimeout(() => searchInput.focus(), 100);
            });

            // Close modal - X button
            closeBtn.addEventListener('click', function() {
                modal.style.display = 'none';
            });

            // Close modal - Apply button
            applyBtn.addEventListener('click', function() {
                modal.style.display = 'none';
            });

            // Close modal - Backdrop click
            backdrop.addEventListener('click', function() {
                modal.style.display = 'none';
            });

            // Prevent modal close when clicking inside content
            modal.querySelector('.filter-modal-content').addEventListener('click', function(e) {
                e.stopPropagation();
            });

            // Search functionality
            searchInput.addEventListener('input', function() {
                const searchTerm = this.value.toLowerCase();
                const options = modal.querySelectorAll('.filter-option');

                options.forEach(option => {
                    const label = option.querySelector('label').textContent.toLowerCase();
                    if (label.includes(searchTerm)) {
                        option.classList.remove('hidden');
                    } else {
                        option.classList.add('hidden');
                    }
                });
            });

            // Select All button
            const selectAllBtn = modal.querySelector('.select-all');
            selectAllBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const checkboxes = modal.querySelectorAll('.filter-option:not(.hidden) input[type="checkbox"]');
                checkboxes.forEach(cb => cb.checked = true);
                updateFilterButtonText(filterType);
                updateFilterChips();
            });

            // Clear All button
            const clearAllBtn = modal.querySelector('.clear-all');
            clearAllBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
                checkboxes.forEach(cb => cb.checked = false);
                updateFilterButtonText(filterType);
                updateFilterChips();
            });
        });

        // Close modals on Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                filters.forEach(f => {
                    document.getElementById(`${f}-filter-modal`).style.display = 'none';
                });
            }
        });
    }

    function updateFilterButtonText(filterType) {
        const btn = document.getElementById(`${filterType}-filter-btn`);
        const textSpan = btn.querySelector('.filter-text');
        const checkboxes = document.querySelectorAll(`input[data-filter="${filterType}"]:checked`);
        const count = checkboxes.length;

        const labelMap = {
            'customers': 'Customer',
            'lorries': 'Lorry',
            'pickers': 'Picker'
        };

        if (count === 0) {
            textSpan.textContent = `All ${labelMap[filterType]}${filterType === 'lorries' ? 'ies' : 's'}`;
        } else if (count === 1) {
            textSpan.textContent = checkboxes[0].value;
        } else {
            textSpan.textContent = `${count} ${labelMap[filterType]}${count > 1 ? (filterType === 'lorries' ? 'ies' : 's') : ''} selected`;
        }
    }

    function updateFilterChips() {
        const chipsContainer = document.getElementById('analytics-filter-chips');
        const selectedFiltersDiv = document.getElementById('analytics-selected-filters');
        chipsContainer.innerHTML = '';

        const filters = ['customers', 'lorries', 'pickers'];
        let hasFilters = false;

        const labelMap = {
            'customers': 'Customer',
            'lorries': 'Lorry',
            'pickers': 'Picker'
        };

        filters.forEach(filterType => {
            const checkboxes = document.querySelectorAll(`input[data-filter="${filterType}"]:checked`);
            checkboxes.forEach(cb => {
                hasFilters = true;
                const chip = document.createElement('div');
                chip.className = 'filter-chip';
                chip.innerHTML = `
                    <span>${labelMap[filterType]}: ${cb.value}</span>
                    <span class="chip-remove" data-filter="${filterType}" data-value="${cb.value}">
                        <i class="fas fa-times"></i>
                    </span>
                `;
                chipsContainer.appendChild(chip);

                // Add click handler to remove chip
                chip.querySelector('.chip-remove').addEventListener('click', function() {
                    cb.checked = false;
                    updateFilterButtonText(filterType);
                    updateFilterChips();
                });
            });
        });

        selectedFiltersDiv.style.display = hasFilters ? 'block' : 'none';
    }

    function refreshAnalyticsDashboard(trips) {
        currentFilteredData = trips; // Track the current filtered dataset
        updateAnalyticsKPIs(trips);
        updateAnalyticsCharts(trips);
    }

    function updateAnalyticsKPIs(trips) {
        // Total Orders
        document.getElementById('kpi-total-orders').textContent = trips.length.toLocaleString();

        // Total Trips
        const totalTrips = new Set(trips.map(t => t.trip_id).filter(x => x)).size;
        document.getElementById('kpi-total-trips').textContent = totalTrips.toLocaleString();

        // Total Customers
        const totalCustomers = new Set(trips.map(t => t.account_name).filter(x => x)).size;
        document.getElementById('kpi-total-customers').textContent = totalCustomers.toLocaleString();

        // Total Lorries
        const totalLorries = new Set(trips.map(t => t.trip_lorry).filter(x => x)).size;
        document.getElementById('kpi-total-lorries').textContent = totalLorries.toLocaleString();

        // Total Pickers
        const totalPickers = new Set(trips.map(t => t.PICKER).filter(x => x)).size;
        document.getElementById('kpi-total-pickers').textContent = totalPickers.toLocaleString();

        // Average Orders per Trip
        const avgOrders = totalTrips > 0 ? (trips.length / totalTrips).toFixed(1) : 0;
        document.getElementById('kpi-avg-orders').textContent = avgOrders;
    }

    function updateAnalyticsCharts(trips) {
        createOrdersTrendChart(trips);
        createWeeklyTrendChart(trips);
        createMonthlyTrendChart(trips);
        createStatusDistChart(trips);
        createOrdersByLorryChart(trips);
        createOrdersByPickerChart(trips);
        createTopCustomersChart(trips);
        createWeightByLorryChart(trips);
    }

    function createOrdersTrendChart(trips) {
        const ctx = document.getElementById('chart-orders-trend');
        if (!ctx) return;

        // Group by date
        const dateCount = {};
        trips.forEach(trip => {
            const date = trip.trip_date || trip.ORDER_DATE || 'Unknown';
            dateCount[date] = (dateCount[date] || 0) + 1;
        });

        const sortedDates = Object.keys(dateCount).sort();
        const counts = sortedDates.map(date => dateCount[date]);

        if (analyticsCharts.ordersTrend) {
            analyticsCharts.ordersTrend.destroy();
        }

        analyticsCharts.ordersTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sortedDates,
                datasets: [{
                    label: 'Orders',
                    data: counts,
                    borderColor: 'rgb(99, 102, 241)',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    function createWeeklyTrendChart(trips) {
        const ctx = document.getElementById('chart-weekly-trend');
        if (!ctx) return;

        // Group by week (ISO week: YYYY-WW format)
        const weekCount = {};
        trips.forEach(trip => {
            const date = trip.trip_date || trip.ORDER_DATE || 'Unknown';
            if (date === 'Unknown') return;

            const d = new Date(date);
            const year = d.getFullYear();
            const week = getWeekNumber(d);
            const weekKey = `${year}-W${String(week).padStart(2, '0')}`;

            weekCount[weekKey] = (weekCount[weekKey] || 0) + 1;
        });

        const sortedWeeks = Object.keys(weekCount).sort();
        const counts = sortedWeeks.map(week => weekCount[week]);

        if (analyticsCharts.weeklyTrend) {
            analyticsCharts.weeklyTrend.destroy();
        }

        analyticsCharts.weeklyTrend = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sortedWeeks,
                datasets: [{
                    label: 'Orders',
                    data: counts,
                    backgroundColor: 'rgba(245, 158, 11, 0.8)',
                    borderColor: 'rgba(245, 158, 11, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    function createMonthlyTrendChart(trips) {
        const ctx = document.getElementById('chart-monthly-trend');
        if (!ctx) return;

        // Group by month (YYYY-MM format)
        const monthCount = {};
        trips.forEach(trip => {
            const date = trip.trip_date || trip.ORDER_DATE || 'Unknown';
            if (date === 'Unknown') return;

            const d = new Date(date);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const monthKey = `${year}-${month}`;

            monthCount[monthKey] = (monthCount[monthKey] || 0) + 1;
        });

        const sortedMonths = Object.keys(monthCount).sort();
        const counts = sortedMonths.map(month => monthCount[month]);

        if (analyticsCharts.monthlyTrend) {
            analyticsCharts.monthlyTrend.destroy();
        }

        analyticsCharts.monthlyTrend = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sortedMonths,
                datasets: [{
                    label: 'Orders',
                    data: counts,
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    // Helper function to get ISO week number
    function getWeekNumber(d) {
        d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return weekNo;
    }

    function createStatusDistChart(trips) {
        const ctx = document.getElementById('chart-status-dist');
        if (!ctx) return;

        // Group by status
        const statusCount = {};
        trips.forEach(trip => {
            const status = trip.LINE_STATUS || 'Unknown';
            statusCount[status] = (statusCount[status] || 0) + 1;
        });

        const labels = Object.keys(statusCount);
        const counts = Object.values(statusCount);

        const colors = [
            'rgba(99, 102, 241, 0.8)',
            'rgba(59, 130, 246, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(239, 68, 68, 0.8)',
            'rgba(139, 92, 246, 0.8)'
        ];

        if (analyticsCharts.statusDist) {
            analyticsCharts.statusDist.destroy();
        }

        analyticsCharts.statusDist = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: counts,
                    backgroundColor: colors.slice(0, labels.length)
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }

    function createOrdersByLorryChart(trips) {
        const ctx = document.getElementById('chart-orders-lorry');
        if (!ctx) return;

        // Group by lorry
        const lorryCount = {};
        trips.forEach(trip => {
            const lorry = trip.trip_lorry || 'Unknown';
            lorryCount[lorry] = (lorryCount[lorry] || 0) + 1;
        });

        // Sort by count descending and take top 10
        const sorted = Object.entries(lorryCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const labels = sorted.map(x => x[0]);
        const counts = sorted.map(x => x[1]);

        if (analyticsCharts.ordersLorry) {
            analyticsCharts.ordersLorry.destroy();
        }

        analyticsCharts.ordersLorry = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Orders',
                    data: counts,
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { beginAtZero: true }
                }
            }
        });
    }

    function createOrdersByPickerChart(trips) {
        const ctx = document.getElementById('chart-orders-picker');
        if (!ctx) return;

        // Group by picker
        const pickerCount = {};
        trips.forEach(trip => {
            const picker = trip.PICKER || 'Unknown';
            pickerCount[picker] = (pickerCount[picker] || 0) + 1;
        });

        // Sort by count descending and take top 10
        const sorted = Object.entries(pickerCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const labels = sorted.map(x => x[0]);
        const counts = sorted.map(x => x[1]);

        if (analyticsCharts.ordersPicker) {
            analyticsCharts.ordersPicker.destroy();
        }

        analyticsCharts.ordersPicker = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Orders',
                    data: counts,
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { beginAtZero: true }
                }
            }
        });
    }

    function createTopCustomersChart(trips) {
        const ctx = document.getElementById('chart-top-customers');
        if (!ctx) return;

        // Group by customer
        const customerCount = {};
        trips.forEach(trip => {
            const customer = trip.account_name || 'Unknown';
            customerCount[customer] = (customerCount[customer] || 0) + 1;
        });

        // Sort by count descending and take top 10
        const sorted = Object.entries(customerCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const labels = sorted.map(x => x[0]);
        const counts = sorted.map(x => x[1]);

        if (analyticsCharts.topCustomers) {
            analyticsCharts.topCustomers.destroy();
        }

        analyticsCharts.topCustomers = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Orders',
                    data: counts,
                    backgroundColor: 'rgba(245, 158, 11, 0.8)',
                    borderColor: 'rgba(245, 158, 11, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { beginAtZero: true }
                }
            }
        });
    }

    function createWeightByLorryChart(trips) {
        const ctx = document.getElementById('chart-weight-lorry');
        if (!ctx) return;

        // Find weight fields
        const weightFields = Object.keys(trips[0] || {}).filter(key =>
            key.toLowerCase().includes('weight')
        );

        if (weightFields.length === 0) {
            // No weight data available
            if (analyticsCharts.weightLorry) {
                analyticsCharts.weightLorry.destroy();
            }
            ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
            const parent = ctx.parentElement;
            const msg = document.createElement('p');
            msg.textContent = 'No weight data available';
            msg.style.textAlign = 'center';
            msg.style.color = '#94a3b8';
            parent.appendChild(msg);
            return;
        }

        // Use first weight field
        const weightField = weightFields[0];

        // Group by lorry and sum weight
        const lorryWeight = {};
        trips.forEach(trip => {
            const lorry = trip.trip_lorry || 'Unknown';
            const weight = parseFloat(trip[weightField]) || 0;
            lorryWeight[lorry] = (lorryWeight[lorry] || 0) + weight;
        });

        // Sort by weight descending and take top 10
        const sorted = Object.entries(lorryWeight)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const labels = sorted.map(x => x[0]);
        const weights = sorted.map(x => x[1].toFixed(2));

        if (analyticsCharts.weightLorry) {
            analyticsCharts.weightLorry.destroy();
        }

        analyticsCharts.weightLorry = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Weight',
                    data: weights,
                    backgroundColor: 'rgba(139, 92, 246, 0.8)',
                    borderColor: 'rgba(139, 92, 246, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { beginAtZero: true }
                }
            }
        });
    }

    // Analytics Refresh Button
    document.getElementById('analytics-refresh-btn').addEventListener('click', function() {
        if (!analyticsData) {
            alert('No data available. Please fetch trips first.');
            return;
        }

        let filteredData = applyAnalyticsFilters();
        refreshAnalyticsDashboard(filteredData);
    });

    // Analytics Clear Filters Button
    document.getElementById('analytics-clear-filters-btn').addEventListener('click', function() {
        // Reset date filters
        document.getElementById('analytics-date-from').value = '';
        document.getElementById('analytics-date-to').value = '';

        // Clear all checkbox filters
        const allCheckboxes = document.querySelectorAll('.filter-option input[type="checkbox"]');
        allCheckboxes.forEach(cb => cb.checked = false);

        // Update button texts
        updateFilterButtonText('customers');
        updateFilterButtonText('lorries');
        updateFilterButtonText('pickers');

        // Update chips
        updateFilterChips();

        // Refresh with all data
        if (analyticsData) {
            refreshAnalyticsDashboard(analyticsData);
        }
    });

    // Apply all analytics filters
    function applyAnalyticsFilters() {
        if (!analyticsData) return [];

        const fromDate = document.getElementById('analytics-date-from').value;
        const toDate = document.getElementById('analytics-date-to').value;

        // Get selected filter values from checkboxes
        const selectedCustomers = Array.from(document.querySelectorAll('input[data-filter="customers"]:checked')).map(cb => cb.value);
        const selectedLorries = Array.from(document.querySelectorAll('input[data-filter="lorries"]:checked')).map(cb => cb.value);
        const selectedPickers = Array.from(document.querySelectorAll('input[data-filter="pickers"]:checked')).map(cb => cb.value);

        let filteredData = analyticsData.filter(trip => {
            // Date filter
            const tripDate = trip.trip_date || trip.ORDER_DATE;
            if (tripDate) {
                if (fromDate && tripDate < fromDate) return false;
                if (toDate && tripDate > toDate) return false;
            }

            // Customer filter
            if (selectedCustomers.length > 0) {
                if (!selectedCustomers.includes(trip.account_name)) return false;
            }

            // Lorry filter
            if (selectedLorries.length > 0) {
                if (!selectedLorries.includes(trip.trip_lorry)) return false;
            }

            // Picker filter
            if (selectedPickers.length > 0) {
                if (!selectedPickers.includes(trip.PICKER)) return false;
            }

            return true;
        });

        return filteredData;
    }

    // Analytics Show Details Button
    document.getElementById('analytics-show-details-btn').addEventListener('click', function() {
        if (!currentFilteredData || currentFilteredData.length === 0) {
            alert('No data available. Please fetch trips and apply filters first.');
            return;
        }

        showAnalyticsDetails(currentFilteredData);
    });

    // Details Modal Close Handlers
    document.getElementById('details-modal-close').addEventListener('click', function() {
        document.getElementById('analytics-details-modal').style.display = 'none';
    });

    document.getElementById('details-modal-ok').addEventListener('click', function() {
        document.getElementById('analytics-details-modal').style.display = 'none';
    });

    document.querySelector('#analytics-details-modal .filter-modal-backdrop').addEventListener('click', function() {
        document.getElementById('analytics-details-modal').style.display = 'none';
    });

    function showAnalyticsDetails(trips) {
        const modal = document.getElementById('analytics-details-modal');
        const content = document.getElementById('analytics-details-content');

        // Calculate statistics
        const totalOrders = trips.length;
        const totalTrips = new Set(trips.map(t => t.trip_id).filter(x => x)).size;
        const totalCustomers = new Set(trips.map(t => t.account_name).filter(x => x)).size;
        const totalLorries = new Set(trips.map(t => t.trip_lorry).filter(x => x)).size;
        const totalPickers = new Set(trips.map(t => t.PICKER).filter(x => x)).size;
        const avgOrdersPerTrip = totalTrips > 0 ? (totalOrders / totalTrips).toFixed(1) : 0;

        // Get active filters
        const fromDate = document.getElementById('analytics-date-from').value;
        const toDate = document.getElementById('analytics-date-to').value;
        const selectedCustomers = Array.from(document.querySelectorAll('input[data-filter="customers"]:checked')).map(cb => cb.value);
        const selectedLorries = Array.from(document.querySelectorAll('input[data-filter="lorries"]:checked')).map(cb => cb.value);
        const selectedPickers = Array.from(document.querySelectorAll('input[data-filter="pickers"]:checked')).map(cb => cb.value);

        // Get status breakdown
        const statusCount = {};
        trips.forEach(trip => {
            const status = trip.LINE_STATUS || 'Unknown';
            statusCount[status] = (statusCount[status] || 0) + 1;
        });

        // Build details HTML
        let html = `
            <div style="margin-bottom: 1.5rem;">
                <h4 style="margin: 0 0 1rem 0; color: #1e293b; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-filter" style="color: #6366f1;"></i> Active Filters
                </h4>
                <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; border: 1px solid #e2e8f0;">
        `;

        if (!fromDate && !toDate && selectedCustomers.length === 0 && selectedLorries.length === 0 && selectedPickers.length === 0) {
            html += '<p style="margin: 0; color: #64748b; font-style: italic;">No filters applied - showing all data</p>';
        } else {
            html += '<ul style="margin: 0; padding-left: 1.5rem;">';
            if (fromDate || toDate) {
                html += `<li><strong>Date Range:</strong> ${fromDate || 'Any'} to ${toDate || 'Any'}</li>`;
            }
            if (selectedCustomers.length > 0) {
                html += `<li><strong>Customers:</strong> ${selectedCustomers.length} selected (${selectedCustomers.slice(0, 3).join(', ')}${selectedCustomers.length > 3 ? '...' : ''})</li>`;
            }
            if (selectedLorries.length > 0) {
                html += `<li><strong>Lorries:</strong> ${selectedLorries.length} selected (${selectedLorries.slice(0, 3).join(', ')}${selectedLorries.length > 3 ? '...' : ''})</li>`;
            }
            if (selectedPickers.length > 0) {
                html += `<li><strong>Pickers:</strong> ${selectedPickers.length} selected (${selectedPickers.slice(0, 3).join(', ')}${selectedPickers.length > 3 ? '...' : ''})</li>`;
            }
            html += '</ul>';
        }

        html += `
                </div>
            </div>

            <div style="margin-bottom: 1.5rem;">
                <h4 style="margin: 0 0 1rem 0; color: #1e293b; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-chart-pie" style="color: #10b981;"></i> Summary Statistics
                </h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 1.75rem; font-weight: 700;">${totalOrders.toLocaleString()}</div>
                        <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 0.25rem;">Orders</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 1rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 1.75rem; font-weight: 700;">${totalTrips.toLocaleString()}</div>
                        <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 0.25rem;">Trips</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 1rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 1.75rem; font-weight: 700;">${totalCustomers.toLocaleString()}</div>
                        <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 0.25rem;">Customers</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: white; padding: 1rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 1.75rem; font-weight: 700;">${totalLorries.toLocaleString()}</div>
                        <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 0.25rem;">Lorries</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: white; padding: 1rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 1.75rem; font-weight: 700;">${totalPickers.toLocaleString()}</div>
                        <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 0.25rem;">Pickers</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #30cfd0 0%, #330867 100%); color: white; padding: 1rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 1.75rem; font-weight: 700;">${avgOrdersPerTrip}</div>
                        <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 0.25rem;">Avg/Trip</div>
                    </div>
                </div>
            </div>

            <div>
                <h4 style="margin: 0 0 1rem 0; color: #1e293b; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-list-check" style="color: #f59e0b;"></i> Status Breakdown
                </h4>
                <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; border: 1px solid #e2e8f0;">
        `;

        Object.entries(statusCount).forEach(([status, count]) => {
            const percentage = ((count / totalOrders) * 100).toFixed(1);
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #e2e8f0;">
                    <span style="font-weight: 500; color: #475569;">${status}</span>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div style="width: 200px; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${percentage}%; height: 100%; background: #6366f1; transition: width 0.3s ease;"></div>
                        </div>
                        <span style="font-weight: 700; color: #1e293b; min-width: 80px; text-align: right;">${count.toLocaleString()} (${percentage}%)</span>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>

            <div style="margin-top: 1.5rem;">
                <h4 style="margin: 0 0 1rem 0; color: #1e293b; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-receipt" style="color: #8b5cf6;"></i> Transaction Details
                    <span style="font-size: 0.75rem; color: #64748b; font-weight: 400; margin-left: auto;">Showing ${Math.min(trips.length, 50)} of ${trips.length.toLocaleString()} records</span>
                </h4>
                <div style="background: white; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;">
                    <div style="max-height: 400px; overflow-y: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
                            <thead style="position: sticky; top: 0; background: #f8fafc; z-index: 10;">
                                <tr>
                                    <th style="padding: 0.75rem; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; white-space: nowrap;">Order #</th>
                                    <th style="padding: 0.75rem; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; white-space: nowrap;">Trip ID</th>
                                    <th style="padding: 0.75rem; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Customer</th>
                                    <th style="padding: 0.75rem; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Lorry</th>
                                    <th style="padding: 0.75rem; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Picker</th>
                                    <th style="padding: 0.75rem; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Status</th>
                                    <th style="padding: 0.75rem; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; white-space: nowrap;">Date</th>
                                </tr>
                            </thead>
                            <tbody>
        `;

        // Show first 50 records
        const displayTrips = trips.slice(0, 50);
        displayTrips.forEach((trip, index) => {
            const rowBg = index % 2 === 0 ? '#ffffff' : '#f9fafb';
            const statusColor = getStatusColor(trip.LINE_STATUS);

            html += `
                <tr style="background: ${rowBg}; transition: background 0.15s ease;">
                    <td style="padding: 0.75rem; border-bottom: 1px solid #e2e8f0; white-space: nowrap;">${trip.order_number || '-'}</td>
                    <td style="padding: 0.75rem; border-bottom: 1px solid #e2e8f0; white-space: nowrap;">${trip.trip_id || '-'}</td>
                    <td style="padding: 0.75rem; border-bottom: 1px solid #e2e8f0;">${trip.account_name || '-'}</td>
                    <td style="padding: 0.75rem; border-bottom: 1px solid #e2e8f0;">${trip.trip_lorry || '-'}</td>
                    <td style="padding: 0.75rem; border-bottom: 1px solid #e2e8f0;">${trip.PICKER || '-'}</td>
                    <td style="padding: 0.75rem; border-bottom: 1px solid #e2e8f0;">
                        <span style="background: ${statusColor}; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 500; white-space: nowrap;">
                            ${trip.LINE_STATUS || 'Unknown'}
                        </span>
                    </td>
                    <td style="padding: 0.75rem; border-bottom: 1px solid #e2e8f0; white-space: nowrap;">${trip.trip_date || trip.ORDER_DATE || '-'}</td>
                </tr>
            `;
        });

        html += `
                            </tbody>
                        </table>
                    </div>
        `;

        if (trips.length > 50) {
            html += `
                    <div style="padding: 1rem; background: #f8fafc; text-align: center; border-top: 1px solid #e2e8f0;">
                        <p style="margin: 0; color: #64748b; font-size: 0.875rem;">
                            <i class="fas fa-info-circle"></i>
                            Showing first 50 records. Click "Export to Excel" to download all ${trips.length.toLocaleString()} records.
                        </p>
                    </div>
            `;
        }

        html += `
                </div>
            </div>
        `;

        content.innerHTML = html;
        modal.style.display = 'flex';
    }

    function getStatusColor(status) {
        if (!status) return '#64748b';
        const s = status.toLowerCase();
        if (s.includes('complete') || s.includes('delivered')) return '#10b981';
        if (s.includes('pending') || s.includes('processing')) return '#f59e0b';
        if (s.includes('cancel') || s.includes('failed')) return '#ef4444';
        if (s.includes('shipped') || s.includes('transit')) return '#3b82f6';
        return '#8b5cf6';
    }

    // Analytics Export to Excel
    document.getElementById('analytics-export-btn').addEventListener('click', function() {
        if (!analyticsData) {
            alert('No data available to export.');
            return;
        }

        let exportData = applyAnalyticsFilters();
        exportAnalyticsToExcel(exportData);
    });

    function exportAnalyticsToExcel(trips) {
        const workbook = new ExcelJS.Workbook();

        // Summary Sheet
        const summarySheet = workbook.addWorksheet('Summary');
        summarySheet.columns = [
            { header: 'Metric', key: 'metric', width: 30 },
            { header: 'Value', key: 'value', width: 20 }
        ];

        const totalTrips = new Set(trips.map(t => t.trip_id).filter(x => x)).size;
        const totalCustomers = new Set(trips.map(t => t.account_name).filter(x => x)).size;
        const totalLorries = new Set(trips.map(t => t.trip_lorry).filter(x => x)).size;
        const totalPickers = new Set(trips.map(t => t.PICKER).filter(x => x)).size;
        const avgOrders = totalTrips > 0 ? (trips.length / totalTrips).toFixed(1) : 0;

        summarySheet.addRows([
            { metric: 'Total Orders', value: trips.length },
            { metric: 'Total Trips', value: totalTrips },
            { metric: 'Total Customers', value: totalCustomers },
            { metric: 'Total Lorries', value: totalLorries },
            { metric: 'Total Pickers', value: totalPickers },
            { metric: 'Average Orders per Trip', value: avgOrders }
        ]);

        // Style summary sheet
        summarySheet.getRow(1).font = { bold: true };
        summarySheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF6366F1' }
        };

        // Raw Data Sheet
        const dataSheet = workbook.addWorksheet('Trip Data');
        if (trips.length > 0) {
            const headers = Object.keys(trips[0]);
            dataSheet.columns = headers.map(h => ({
                header: h,
                key: h,
                width: 15
            }));

            trips.forEach(trip => {
                dataSheet.addRow(trip);
            });

            // Style data sheet
            dataSheet.getRow(1).font = { bold: true };
            dataSheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF6366F1' }
            };
        }

        // Save file
        workbook.xlsx.writeBuffer().then(buffer => {
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            saveAs(blob, `WMS_Analytics_${timestamp}.xlsx`);
        });
    }

    // Auto-update analytics when trip data is fetched
    const originalDisplayTripData = displayTripData;
    displayTripData = function(trips) {
        originalDisplayTripData(trips);
        updateAnalytics(trips);
    };

    console.log('[JS] ✅ Application initialized');
});
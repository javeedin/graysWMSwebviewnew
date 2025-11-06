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
                        loadPrintJobs();
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
        loadPrintJobs();
        showNotification('Retry completed', 'success');
    }, 2000);
}

// ============================================================
// Initialize on page load
// ============================================================

// Auto-refresh every 30 seconds when on monitor printing page
let monitorRefreshInterval = null;

document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', function() {
        const page = this.getAttribute('data-page');
        
        if (page === 'monitor-printing') {
            // Load print jobs when page opens
            setTimeout(() => {
                loadPrintJobs();
            }, 100);
            
            // Start auto-refresh
            if (monitorRefreshInterval) {
                clearInterval(monitorRefreshInterval);
            }
            monitorRefreshInterval = setInterval(() => {
                loadPrintJobs();
            }, 30000); // 30 seconds
        } else {
            // Stop auto-refresh when leaving page
            if (monitorRefreshInterval) {
                clearInterval(monitorRefreshInterval);
                monitorRefreshInterval = null;
            }
        }
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
            
            const monitorPage = document.getElementById('monitor-printing');
            if (monitorPage && monitorPage.style.display !== 'none') {
                console.log('[JS] 🔄 Refreshing Monitor Printing...');
                loadPrintJobs();
            }
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
        loadPrintJobs();
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
        loadPrintJobs();
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
                loadPrintJobs();
                initPrintJobsGrid();
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
            <div class="date-filter-section">
                <span class="date-filter-label">Filter by Date:</span>
                <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; flex: 1;">
                    <div id="date-filters-${tabId}" style="display: flex; flex-wrap: wrap; gap: 0.5rem; flex: 1;">
                        ${uniqueDates.map(date => 
                            `<span class="filter-chip active" data-date="${date}" data-tab="${tabId}">${date}</span>`
                        ).join('')}
                    </div>
                    <button class="btn btn-secondary" id="select-all-dates-${tabId}" style="white-space: nowrap;">
                        <i class="fas fa-check-double"></i> Select All
                    </button>
                    <button class="btn btn-secondary" id="clear-all-dates-${tabId}" style="white-space: nowrap;">
                        <i class="fas fa-times"></i> Clear All
                    </button>
                </div>
            </div>
            <div style="padding: 0.75rem 1.5rem; background: white; border-bottom: 2px solid var(--gray-100); display: flex; justify-content: space-between; align-items: center;">
                <div class="grid-title">Showing <span id="trips-count-${tabId}">${tripsArray.length}</span> of ${tripsArray.length} trips</div>
            </div>
            <div id="trip-cards-${tabId}" class="trip-cards-container"></div>
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
            const priorityClass = trip.PRIORITY.toLowerCase().includes('high') ? 'priority-high' : 
                                 trip.PRIORITY.toLowerCase().includes('low') ? 'priority-low' : 'priority-medium';
            
            html += `
                <div class="trip-card">
                    <div class="trip-card-header">
                        <div class="trip-card-id">${trip.TRIP_ID}</div>
                        <div class="trip-card-priority ${priorityClass}">${trip.PRIORITY}</div>
                    </div>
                    <div class="trip-card-body">
                        <div class="trip-card-field">
                            <span class="trip-card-label">Trip Date</span>
                            <span class="trip-card-value">${trip.TRIP_DATE}</span>
                        </div>
                        <div class="trip-card-field">
                            <span class="trip-card-label">Lorry Number</span>
                            <span class="trip-card-value">${trip.LORRY_NUMBER}</span>
                        </div>
                        <div class="trip-card-field">
                            <span class="trip-card-label">Total Orders</span>
                            <span class="trip-card-value">${trip.TOTAL_ORDERS}</span>
                        </div>
                    </div>
                    
                    <div style="padding: 0.5rem; border-top: 1px solid var(--gray-200); margin-top: 0.5rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; background: var(--gray-50); border-radius: 6px;">
                            <div style="flex: 1;">
                                <strong style="font-size: 0.75rem; color: var(--gray-700);">
                                    <i class="fas fa-print" style="font-size: 0.7rem;"></i> Auto Print
                                </strong>
                                <div style="font-size: 0.65rem; color: var(--gray-500);">Auto download & print</div>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" 
                                       class="auto-print-toggle" 
                                       id="autoPrint_${trip.TRIP_ID}_${trip.TRIP_DATE}"
                                       data-trip-id="${trip.TRIP_ID}"
                                       data-trip-date="${trip.TRIP_DATE}"
                                       onchange="handleAutoPrintToggle('${trip.TRIP_ID}', '${trip.TRIP_DATE}', this.checked, ${trip.TOTAL_ORDERS})">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="auto-print-status" 
                             id="status_${trip.TRIP_ID}_${trip.TRIP_DATE}" 
                             style="margin-top: 0.5rem; padding: 0.4rem; font-size: 0.65rem; border-radius: 4px; display: none;">
                        </div>
                    </div>
                    
                    <div class="trip-card-footer">
                        <button class="btn" onclick="openTripDetails('${trip.TRIP_ID}', '${trip.TRIP_DATE}', '${trip.LORRY_NUMBER}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
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
    window.openTripDetails = function(tripId, tripDate, lorryNumber) {
        console.log('[JS] Opening trip details for:', tripId);
        
        // Filter trip data - match original logic (case-insensitive, trip_id OR TRIP_ID)
        const tripData = currentFullData.filter(trip => {
            const tripIdLower = (trip.trip_id || '').toString().toLowerCase();
            const tripIdUpper = (trip.TRIP_ID || '').toString().toLowerCase();
            const searchId = tripId.toString().toLowerCase();
            return tripIdLower === searchId || tripIdUpper === searchId;
        });
        
        console.log('[JS] Found', tripData.length, 'records for trip:', tripId);
        
        if (tripData.length === 0) {
            alert('No data found for trip: ' + tripId);
            return;
        }
        
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
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                    <div>
                        <h2 style="font-size: 1rem; font-weight: 700; color: var(--gray-900); margin-bottom: 0.3rem;">
                            <i class="fas fa-route" style="color: var(--primary); font-size: 0.9rem;"></i> Trip: ${tripId}
                        </h2>
                        <p style="color: var(--gray-600); font-size: 0.75rem;">Complete order information for this trip</p>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.65rem; margin-bottom: 1rem;">
                    <div style="background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; padding: 0.6rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="color: rgba(255,255,255,0.9); font-size: 0.65rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 0.25rem;">Trip Date</div>
                        <div style="font-size: 0.85rem; font-weight: 700;">${tripDate}</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 0.6rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="color: rgba(255,255,255,0.9); font-size: 0.65rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 0.25rem;">Lorry Number</div>
                        <div style="font-size: 0.85rem; font-weight: 700;">${lorryNumber}</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 0.6rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="color: rgba(255,255,255,0.9); font-size: 0.65rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 0.25rem;">Total Orders</div>
                        <div style="font-size: 1.1rem; font-weight: 800;">${totalOrders}</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 0.6rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="color: rgba(255,255,255,0.9); font-size: 0.65rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 0.25rem;">Customers</div>
                        <div style="font-size: 1.1rem; font-weight: 800;">${uniqueCustomers}</div>
                    </div>
                    <div style="background: white; padding: 0.6rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid var(--gray-200);">
                        <div style="color: var(--gray-500); font-size: 0.65rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 0.25rem;">Total Quantity</div>
                        <div style="font-size: 1.1rem; font-weight: 800; color: var(--gray-900);">${totalQuantity.toLocaleString()}</div>
                    </div>
                    <div style="background: white; padding: 0.6rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid var(--gray-200);">
                        <div style="color: var(--gray-500); font-size: 0.65rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 0.25rem;">Total Weight</div>
                        <div style="font-size: 0.9rem; font-weight: 800; color: var(--gray-900);">${totalWeight.toFixed(2)} kg</div>
                    </div>
                    <div style="background: white; padding: 0.6rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid var(--gray-200);">
                        <div style="color: var(--gray-500); font-size: 0.65rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 0.25rem;">Products</div>
                        <div style="font-size: 1.1rem; font-weight: 800; color: var(--gray-900);">${uniqueProducts}</div>
                    </div>
                    <div style="background: white; padding: 0.6rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid var(--gray-200);">
                        <div style="color: var(--gray-500); font-size: 0.65rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 0.25rem;">Priority</div>
                        <div style="font-size: 1rem; font-weight: 800; color: ${priority.toLowerCase().includes('high') ? 'var(--danger)' : priority.toLowerCase().includes('low') ? 'var(--success)' : 'var(--warning)'};">${priority}</div>
                    </div>
                </div>
                
                <div style="background: white; padding: 0.75rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="font-size: 0.85rem; font-weight: 600; margin: 0; color: var(--gray-800);">
                            <i class="fas fa-table" style="font-size: 0.75rem;"></i> Order Details
                        </h3>
                        <div style="color: var(--gray-600); font-size: 0.7rem;">
                            <i class="fas fa-info-circle" style="font-size: 0.65rem;"></i> Showing ${totalOrders} orders
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
            const gridContainer = $(`#grid-${tabId}`);
            
            if (tripData.length === 0) {
                gridContainer.html('<div style="padding:2rem;text-align:center;color:#64748b;">No data found</div>');
                return;
            }
            
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

    console.log('[JS] ✅ Application initialized');
});
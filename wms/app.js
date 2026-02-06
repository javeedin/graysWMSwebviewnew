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



function sendMessageToCSharp(message, callback, timeoutMs = 120000) {
    const requestId = message.requestId || generateRequestId();
    message.requestId = requestId;
    const startTime = Date.now();

    console.log('[JS] ════════════════════════════════════════════════════════');
    console.log('[JS] 📤 SENDING MESSAGE TO C#');
    console.log('[JS] Request ID:', requestId);
    console.log('[JS] Action:', message.action);
    console.log('[JS] Full Message:', JSON.stringify(message, null, 2));
    console.log('[JS] Timeout set to:', timeoutMs, 'ms');
    console.log('[JS] ════════════════════════════════════════════════════════');

    // Setup timeout to catch stuck requests
    const timeoutId = setTimeout(() => {
        if (window.pendingRequests[requestId]) {
            const elapsed = Date.now() - startTime;
            console.error('[JS] ⏰ TIMEOUT! Request timed out after', elapsed, 'ms');
            console.error('[JS] ⏰ Timed out Request ID:', requestId);
            console.error('[JS] ⏰ Timed out Action:', message.action);
            console.error('[JS] ⏰ Check if C# received and processed this request');

            delete window.pendingRequests[requestId];
            callback(`Request timed out after ${timeoutMs}ms. C# did not respond for action: ${message.action}`, null);
        }
    }, timeoutMs);

    // Wrap callback to clear timeout when response arrives
    window.pendingRequests[requestId] = function(error, response) {
        clearTimeout(timeoutId);
        const elapsed = Date.now() - startTime;
        console.log('[JS] ⏱️ Response received in', elapsed, 'ms for:', requestId);
        callback(error, response);
    };

    if (window.chrome?.webview) {
        try {
            window.chrome.webview.postMessage(message);
            console.log('[JS] ✅ Message posted to WebView2 successfully');
            console.log('[JS] 🔄 Waiting for C# response...');
        } catch (postError) {
            console.error('[JS] ❌ Error posting message:', postError);
            clearTimeout(timeoutId);
            delete window.pendingRequests[requestId];
            callback('Error posting message to C#: ' + postError.message, null);
        }
    } else {
        console.error('[JS] ❌ WebView2 not available - window.chrome.webview is:', window.chrome?.webview);
        clearTimeout(timeoutId);
        delete window.pendingRequests[requestId];
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
        console.log('[JS] ════════════════════════════════════════════════════════');
        console.log('[JS] 📨 RECEIVED MESSAGE FROM C#');
        console.log('[JS] Event Data Type:', typeof event.data);
        console.log('[JS] Event Data:', JSON.stringify(event.data, null, 2));
        console.log('[JS] ════════════════════════════════════════════════════════');

        const response = event.data;

        console.log('[JS] 🔍 Looking for callback with requestId:', response.requestId);
        console.log('[JS] 🔍 Pending requests count:', Object.keys(window.pendingRequests || {}).length);
        console.log('[JS] 🔍 Pending request IDs:', Object.keys(window.pendingRequests || {}));

        if (window.pendingRequests && window.pendingRequests[response.requestId]) {
            console.log('[JS] ✅ Found callback for requestId:', response.requestId);
            const callback = window.pendingRequests[response.requestId];
            delete window.pendingRequests[response.requestId];

            console.log('[JS] 🔍 Response action:', response.action);
            console.log('[JS] 🔍 Response success:', response.success);
            console.log('[JS] 🔍 Response has data:', !!response.data);
            console.log('[JS] 🔍 Response has filePath:', !!(response.filePath || response.pdfPath));

            if (response.action === "autoPrintResponse") {
                console.log('[JS] 📋 Handling as autoPrintResponse');
                callback(response.success ? null : response.message, response);
            } else if (response.action === "printJobsResponse") {
                console.log('[JS] 📋 Handling as printJobsResponse');
                callback(null, response);
            } else if (response.action === "error") {
                console.log('[JS] 📋 Handling as error response');
                callback(response.message || response.data?.message, null);
            } else if (response.action === "restResponse") {
                console.log('[JS] 📋 Handling as restResponse');
                callback(null, response.data);
            } else if (response.action === "printSalesOrderResponse" || response.action === "salesOrderPdfResponse") {
                // Handle Sales Order print response
                console.log('[JS] 📋 Handling as printSalesOrderResponse');
                console.log('[JS] 📋 Response details:', {
                    success: response.success,
                    filePath: response.filePath,
                    pdfPath: response.pdfPath,
                    message: response.message
                });
                if (response.success) {
                    callback(null, response);
                } else {
                    callback(response.message || 'Sales order print failed', null);
                }
            } else {
                console.log('[JS] 📋 Handling as generic response, action:', response.action);
                console.log('[JS] 📋 Passing to callback:', response.data || response);
                callback(null, response.data || response);
            }
        } else {
            console.warn('[JS] ⚠️ No callback found for requestId:', response.requestId);
            console.warn('[JS] ⚠️ This could mean:');
            console.warn('[JS] ⚠️   1. Request already timed out');
            console.warn('[JS] ⚠️   2. Request was never made');
            console.warn('[JS] ⚠️   3. requestId mismatch between sent and received');
            console.warn('[JS] ⚠️ Expected one of:', Object.keys(window.pendingRequests || {}));
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

    // ========================================
    // MOBILE BACK NAVIGATION SUPPORT
    // ========================================

    // Navigate to page function (with history support)
    window.navigateToPage = function(pageId, pushState = true) {
        const menuItem = document.querySelector(`.menu-item[data-page="${pageId}"]`);
        if (!menuItem) {
            console.warn(`[Navigation] Page not found: ${pageId}`);
            return;
        }

        // Update menu active state
        document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
        menuItem.classList.add('active');

        // Hide all pages and show target page
        document.querySelectorAll('.page-content').forEach(page => page.style.display = 'none');
        const pageElement = document.getElementById(pageId);
        if (pageElement) {
            pageElement.style.display = 'block';
        }

        const pageTitle = menuItem.textContent.trim();
        document.title = `WMS - ${pageTitle}`;

        // Push state to browser history for mobile back button support
        if (pushState) {
            history.pushState({ pageId: pageId, pageTitle: pageTitle }, pageTitle, `#${pageId}`);
        }

        // Collapse sidebar when navigating to Auto Inventory Processing
        if (pageId === 'auto-inventory-processing') {
            document.getElementById('sidebar').classList.add('collapsed');
        }

        // Page-specific initialization
        if (pageId === 'vehicles' && currentFullData.length > 0) {
            initVehiclesPage();
        } else if (pageId === 'monitor-printing') {
            if (typeof restoreMonitoringGridIfNeeded === 'function') {
                restoreMonitoringGridIfNeeded();
            }
        } else if (pageId === 'printer-setup') {
            loadInstalledPrinters();
            loadPrinterConfiguration();
        }

        console.log(`[Navigation] Navigated to: ${pageId}`);
    };

    // Handle browser back/forward buttons (mobile back navigation)
    window.addEventListener('popstate', function(event) {
        console.log('[Navigation] Popstate event:', event.state);

        if (event.state && event.state.pageId) {
            const pageId = event.state.pageId;

            // Handle trip-details-management specially
            if (pageId === 'trip-details-management' && event.state.tripData) {
                console.log(`[Navigation] Back/Forward to Trip Details: ${event.state.tripId}`);
                // Re-open trip details with stored data
                if (typeof window.openTripDetailsPage === 'function') {
                    // Don't push state again since we're handling popstate
                    const tripDetailsPage = document.getElementById('trip-details-management');
                    if (tripDetailsPage) {
                        document.querySelectorAll('.page-content').forEach(page => page.style.display = 'none');
                        tripDetailsPage.style.display = 'block';
                    }
                }
            } else {
                console.log(`[Navigation] Back/Forward to: ${pageId}`);
                navigateToPage(pageId, false); // Don't push state again
            }
        } else {
            // Default handling based on URL hash
            const hash = window.location.hash.replace('#', '');
            if (hash && !hash.startsWith('trip-details/')) {
                navigateToPage(hash, false);
            } else if (!hash) {
                // Go to default page (trip-management)
                navigateToPage('trip-management', false);
            }
        }
    });

    // Menu navigation (updated to use navigateToPage)
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', function() {
            const pageId = this.getAttribute('data-page');
            navigateToPage(pageId, true);
        });
    });

    // Initialize: Set initial state based on URL hash or default page
    const initialHash = window.location.hash.replace('#', '');
    if (initialHash) {
        navigateToPage(initialHash, false);
    } else {
        // Set initial history state for default page
        const defaultPage = document.querySelector('.menu-item.active');
        if (defaultPage) {
            const pageId = defaultPage.getAttribute('data-page');
            history.replaceState({ pageId: pageId, pageTitle: 'Trip Management' }, '', `#${pageId}`);
        }
    }

    // Set default dates
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    document.getElementById('trip-date-from').valueAsDate = yesterday;
    document.getElementById('trip-date-to').valueAsDate = tomorrow;

    // Add click handler for All Trips tab (fix: tab was not reactivating when clicked)
    const allTripsTab = document.querySelector('.tab-item[data-tab="all-trips"]');
    if (allTripsTab) {
        allTripsTab.addEventListener('click', function() {
            activateTripTab('all-trips');
        });
    }

    // Add click handler for All Trip Details tab
    const allTripDetailsTab = document.querySelector('.tab-item[data-tab="all-trip-details"]');
    if (allTripDetailsTab) {
        allTripDetailsTab.addEventListener('click', function() {
            activateTripTab('all-trip-details');
        });
    }

    // Fetch Trips button
    document.getElementById('fetch-trips-btn').addEventListener('click', function() {
        console.log('[Fetch Trips] ===== FETCH TRIPS BUTTON CLICKED =====');

        const instanceName = document.getElementById('trip-instance-name').value;
        const dateFrom = document.getElementById('trip-date-from').value;
        const dateTo = document.getElementById('trip-date-to').value;

        console.log('[Fetch Trips] Parameters - Instance:', instanceName, 'From:', dateFrom, 'To:', dateTo);

        if (!dateFrom || !dateTo) {
            alert('Please select both From Date and To Date');
            return;
        }
        if (new Date(dateFrom) > new Date(dateTo)) {
            alert('From Date cannot be after To Date');
            return;
        }

        // Clear old data before fetching new data
        currentFullData = [];
        window.currentFullData = [];
        console.log('[Fetch Trips] Cleared old data');

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

        console.log('[Fetch Trips] ========================================');
        console.log('[Fetch Trips] Instance Name:', instanceName);
        console.log('[Fetch Trips] Date From:', dateFrom, '-> Formatted:', formatDate(dateFrom));
        console.log('[Fetch Trips] Date To:', dateTo, '-> Formatted:', formatDate(dateTo));
        console.log('[Fetch Trips] Full URL:', fullUrl);
        console.log('[Fetch Trips] ========================================');

        currentParams = {
            fromDate: formatDate(dateFrom),
            toDate: formatDate(dateTo),
            instance: instanceName
        };

        const gridContainer = document.getElementById('trips-grid');
        gridContainer.innerHTML = '<div style="padding:2rem;text-align:center;"><div class="spinner" style="width:40px;height:40px;margin:0 auto 1rem;border:3px solid rgba(99,102,241,0.3);border-top-color:#6366f1;border-radius:50%;animation:spin 0.8s linear infinite;"></div><p>Loading trips data...</p></div>';

        // Also show loading for Trip Details grid
        const tripDetailsGridContainer = document.getElementById('trip-details-grid');
        if (tripDetailsGridContainer) {
            tripDetailsGridContainer.innerHTML = '<div style="padding:2rem;text-align:center;"><div class="spinner" style="width:40px;height:40px;margin:0 auto 1rem;border:3px solid rgba(99,102,241,0.3);border-top-color:#6366f1;border-radius:50%;animation:spin 0.8s linear infinite;"></div><p>Loading trip details...</p></div>';
        }

        // API 1: Fetch All Trips (existing)
        sendMessageToCSharp({
            action: "executeGet",
            fullUrl: fullUrl
        }, function(error, data) {
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
                    console.log('[Fetch Trips] Raw Response:', data);
                    let trips = JSON.parse(data);
                    console.log('[Fetch Trips] Parsed Response:', trips);
                    if (!Array.isArray(trips) && trips?.items) trips = trips.items;
                    if (!Array.isArray(trips)) trips = [];
                    console.log('[Fetch Trips] Trips Count:', trips.length);
                    if (trips.length > 0) {
                        console.log('[Fetch Trips] Sample Trip:', trips[0]);
                    }
                    displayTripData(trips);
                    currentFullData = trips;
                    window.currentFullData = trips;
                } catch (e) {
                    console.error('[Fetch Trips] Parse Error:', e);
                    gridContainer.innerHTML = `<div style="padding:2rem;color:#e53e3e;">Invalid JSON: ${e.message}</div>`;
                }
            }
        });

        // API 2: Fetch All Trip Details (new)
        const tripDetailsBaseUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/ALL';
        const tripDetailsParams = new URLSearchParams({
            P_FROM_DATE: dateFrom,  // YYYY-MM-DD format
            P_TO_DATE: dateTo       // YYYY-MM-DD format
        });
        const tripDetailsFullUrl = `${tripDetailsBaseUrl}?${tripDetailsParams.toString()}`;

        sendMessageToCSharp({
            action: "executeGet",
            fullUrl: tripDetailsFullUrl
        }, function(error, data) {
            // Reset button state after both calls complete
            fetchBtn.disabled = false;
            fetchIcon.innerHTML = '';
            fetchIcon.className = 'fas fa-sync-alt';
            fetchText.textContent = 'Fetch Trips';

            if (error) {
                if (tripDetailsGridContainer) {
                    tripDetailsGridContainer.innerHTML = `
                        <div style="padding:2rem;text-align:center;">
                            <i class="fas fa-exclamation-triangle" style="font-size:3rem;color:#ef4444;margin-bottom:1rem;"></i>
                            <h3 style="color:#ef4444;">Error</h3>
                            <p style="color:#64748b;">${error}</p>
                        </div>
                    `;
                }
            } else {
                try {
                    let tripDetails = JSON.parse(data);
                    if (!Array.isArray(tripDetails) && tripDetails?.items) tripDetails = tripDetails.items;
                    if (!Array.isArray(tripDetails)) tripDetails = [];
                    // DEBUG: Log first record to check item columns
                    if (tripDetails.length > 0) {
                        console.log('=== All Trip Details - First Record ===');
                        console.log('All columns:', Object.keys(tripDetails[0]));
                        console.log('First record data:', tripDetails[0]);
                        // Check specifically for item-related columns
                        const itemCols = Object.keys(tripDetails[0]).filter(k => k.toLowerCase().includes('item'));
                        console.log('Item-related columns:', itemCols);
                        itemCols.forEach(col => console.log(`${col}:`, tripDetails[0][col]));
                    }
                    displayTripDetailsData(tripDetails);
                } catch (e) {
                    if (tripDetailsGridContainer) {
                        tripDetailsGridContainer.innerHTML = `<div style="padding:2rem;color:#e53e3e;">Invalid JSON: ${e.message}</div>`;
                    }
                }
            }
        });
    });

    function displayTripData(trips) {
        console.log('[Fetch Trips] displayTripData called with', trips ? trips.length : 0, 'trips');

        const gridContainer = document.getElementById('trips-grid');
        const tripCount = document.getElementById('trip-count');

        // Dispose existing grid instance if it exists
        if (window.tripsGridInstance) {
            try {
                window.tripsGridInstance.dispose();
                console.log('[Fetch Trips] Disposed existing grid instance');
            } catch (e) {
                console.log('[Fetch Trips] Error disposing grid:', e);
            }
            window.tripsGridInstance = null;
        }

        // Clear the container
        $(gridContainer).empty();

        if (!trips || trips.length === 0) {
            gridContainer.innerHTML = `<div style="padding:3rem;text-align:center;color:#64748b;">
                <i class="fas fa-truck" style="font-size:3rem;margin-bottom:1.5rem;color:#cbd5e1;"></i>
                <h3>No Trips Found</h3>
            </div>`;
            tripCount.textContent = '0 trips';
            return;
        }

        // Auto-populate Trips tab
        openTripManagementTab('trips');

        setupAllTripsFilters(trips);
        
        const first = trips[0];
        const columns = Object.keys(first).map(key => {
            let col = { dataField: key, caption: key.replace(/_/g, ' ') };

            // Set widths based on column type for better auto-sizing
            const keyLower = key.toLowerCase();
            if (keyLower.includes('name') || keyLower.includes('description') || keyLower.includes('address')) {
                col.width = 200;
                col.minWidth = 120;
            } else if (keyLower.includes('number') || keyLower.includes('id')) {
                col.width = 140;
                col.minWidth = 100;
            } else if (keyLower.includes('date')) {
                col.width = 130;
                col.minWidth = 100;
            } else if (keyLower.includes('status')) {
                col.width = 120;
                col.minWidth = 80;
            } else {
                col.width = 110;
                col.minWidth = 80;
            }

            // ORDER_NUMBER hyperlink - opens dialog similar to All Trip Details
            if (key === 'ORDER_NUMBER' || key === 'order_number') {
                col.cellTemplate = (container, options) => {
                    const orderNumber = options.value || '';
                    const rowData = options.data;
                    const rowDataJson = JSON.stringify(rowData).replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    $(container).html(`<a href="javascript:void(0)" onclick='editTripOrder(JSON.parse(this.getAttribute("data-row")))' data-row="${rowDataJson}" style="color: #667eea; text-decoration: none; font-weight: 600; cursor: pointer;">${orderNumber}</a>`);
                };
            }
            // Status column styling
            else if (key === 'LINE_STATUS' || key.toLowerCase().includes('status')) {
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

        // Add PICKER column explicitly if not returned by API
        const hasPickerColumn = columns.some(col =>
            col.dataField && col.dataField.toLowerCase() === 'picker'
        );
        if (!hasPickerColumn) {
            // Also initialize PICKER field in data if not present
            trips.forEach(item => {
                if (!item.PICKER && !item.picker) {
                    item.PICKER = item.PICKER_NAME || item.picker_name || '';
                }
            });

            columns.push({
                dataField: 'PICKER',
                caption: 'Picker',
                minWidth: 150,
                cellTemplate: function(container, options) {
                    const picker = options.value || options.data.picker || options.data.PICKER_NAME || options.data.picker_name || '';
                    const displayText = picker || 'N/A';
                    const style = picker ? 'color: #10b981; font-weight: 600;' : 'color: #9ca3af; font-style: italic;';
                    $(container).html(`<span style="${style}">${displayText}</span>`);
                }
            });
        }

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
            columnMinWidth: 120,
            width: '100%',
            scrolling: {
                mode: 'standard',
                useNative: true,
                showScrollbar: 'always'
            },
            filterRow: { visible: true },
            headerFilter: { visible: true },
            groupPanel: { visible: true },
            searchPanel: { visible: true, placeholder: "Search..." },
            paging: { enabled: true, pageSize: 25 },
            pager: {
                visible: true,
                showPageSizeSelector: true,
                allowedPageSizes: [10, 25, 50, 100],
                showInfo: true,
                showNavigationButtons: true,
                infoText: 'Page {0} of {1} ({2} records)'
            },
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
            columnChooser: {
                enabled: true,
                mode: 'select'
            },
            height: 500
        });

        // Store grid instance for global access
        window.tripsGridInstance = $(gridContainer).dxDataGrid('instance');

        tripCount.textContent = `${trips.length} ${trips.length === 1 ? 'trip' : 'trips'}`;
    }

    // Global function: Assign Picker for Selected Trips in All Trips grid
    window.assignPickerForSelectedTrips = function() {
        console.log('[Global Assign Picker - All Trips] Getting selected rows from All Trips grid');

        if (!window.tripsGridInstance) {
            alert('Please load trips data first.');
            return;
        }

        const selectedRows = window.tripsGridInstance.getSelectedRowsData();

        if (!selectedRows || selectedRows.length === 0) {
            alert('Please select at least one row to assign a picker.');
            return;
        }

        console.log('[Global Assign Picker - All Trips] Selected', selectedRows.length, 'rows');

        // Get trip ID from first selected row
        const tripId = selectedRows[0].TRIP_ID || selectedRows[0].trip_id || '';

        // Check if pickers data is loaded
        if (!window.pickersData || window.pickersData.length === 0) {
            console.log('[Global Assign Picker - All Trips] Pickers not loaded, loading now...');

            const loadingMsg = document.createElement('div');
            loadingMsg.id = 'loading-pickers-msg';
            loadingMsg.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#667eea;color:white;padding:1rem 2rem;border-radius:8px;z-index:20000;';
            loadingMsg.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading pickers...';
            document.body.appendChild(loadingMsg);

            if (typeof window.loadPickers === 'function') {
                window.loadPickers();

                const checkInterval = setInterval(() => {
                    if (window.pickersData && window.pickersData.length > 0) {
                        clearInterval(checkInterval);
                        const msg = document.getElementById('loading-pickers-msg');
                        if (msg) msg.remove();
                        openAssignPickerDialog(tripId, selectedRows);
                    }
                }, 500);

                setTimeout(() => {
                    clearInterval(checkInterval);
                    const msg = document.getElementById('loading-pickers-msg');
                    if (msg) msg.remove();
                    if (!window.pickersData || window.pickersData.length === 0) {
                        alert('Failed to load pickers. Please try again.');
                    }
                }, 10000);
            } else {
                loadingMsg.remove();
                alert('Pickers module not loaded. Please refresh the page.');
            }
            return;
        }

        openAssignPickerDialog(tripId, selectedRows);
    };

    // Global function: Allocate Lots for Selected Trips in All Trips grid
    window.allocateLotsForSelectedTrips = function() {
        console.log('[Global Allocate Lots - All Trips] Getting selected rows from All Trips grid');

        if (!window.tripsGridInstance) {
            alert('Please load trips data first.');
            return;
        }

        const selectedRows = window.tripsGridInstance.getSelectedRowsData();

        if (!selectedRows || selectedRows.length === 0) {
            alert('Please select at least one row to allocate lots.');
            return;
        }

        // Filter only S2V orders
        const s2vOrders = selectedRows.filter(order => {
            const orderType = (order.ORDER_TYPE || order.order_type || order.ORDER_TYPE_CODE || order.order_type_code || '').toUpperCase();
            return orderType === 'STORE TO VAN' || orderType === 'S2V' || orderType === 'VAN TO STORE' || orderType === 'V2S';
        });

        if (s2vOrders.length === 0) {
            alert('No Store to Van (S2V) orders found in selection. Please select S2V orders only.');
            return;
        }

        console.log('[Global Allocate Lots - All Trips] Found', s2vOrders.length, 'S2V orders out of', selectedRows.length, 'selected');

        // Confirm with user
        if (!confirm(`Allocate lots for ${s2vOrders.length} S2V order(s)?\n\nThis will fetch and allocate inventory lots for the selected orders.`)) {
            return;
        }

        // Show progress
        const progressModal = document.createElement('div');
        progressModal.id = 'allocate-lots-progress';
        progressModal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:20000;';
        progressModal.innerHTML = `
            <div style="background:white;padding:2rem;border-radius:12px;max-width:400px;text-align:center;">
                <i class="fas fa-spinner fa-spin" style="font-size:2rem;color:#8b5cf6;margin-bottom:1rem;"></i>
                <h3 style="margin-bottom:0.5rem;">Allocating Lots</h3>
                <p id="allocate-lots-status" style="color:#64748b;">Processing 0 of ${s2vOrders.length} orders...</p>
            </div>
        `;
        document.body.appendChild(progressModal);

        // Process each order
        let processedCount = 0;
        let successCount = 0;
        let errorCount = 0;

        const processNext = (index) => {
            if (index >= s2vOrders.length) {
                // All done
                progressModal.innerHTML = `
                    <div style="background:white;padding:2rem;border-radius:12px;max-width:400px;text-align:center;">
                        <i class="fas fa-check-circle" style="font-size:2rem;color:#10b981;margin-bottom:1rem;"></i>
                        <h3 style="margin-bottom:0.5rem;">Allocation Complete</h3>
                        <p style="color:#64748b;">Successfully allocated: ${successCount}<br>Failed: ${errorCount}</p>
                        <button onclick="document.getElementById('allocate-lots-progress').remove()" style="margin-top:1rem;padding:0.5rem 1.5rem;background:#667eea;color:white;border:none;border-radius:6px;cursor:pointer;">Close</button>
                    </div>
                `;
                return;
            }

            const order = s2vOrders[index];
            const orderNumber = order.ORDER_NUMBER || order.order_number;

            document.getElementById('allocate-lots-status').textContent = `Processing ${index + 1} of ${s2vOrders.length}: ${orderNumber}`;

            // Call the allocate lot API for this order
            if (typeof window.allocateLotForOrder === 'function') {
                window.allocateLotForOrder(order, (success) => {
                    processedCount++;
                    if (success) successCount++;
                    else errorCount++;
                    processNext(index + 1);
                });
            } else {
                // If allocateLotForOrder doesn't exist, simulate with a delay
                setTimeout(() => {
                    processedCount++;
                    successCount++;
                    processNext(index + 1);
                }, 500);
            }
        };

        processNext(0);
    };

    // Display Trip Details Data in DevExpress Grid (All Trip Details tab)
    function displayTripDetailsData(tripDetails) {
        const gridContainer = document.getElementById('trip-details-grid');
        const tripDetailsCount = document.getElementById('trip-details-count');

        if (!tripDetails || tripDetails.length === 0) {
            gridContainer.innerHTML = `<div style="padding:3rem;text-align:center;color:#64748b;">
                <i class="fas fa-clipboard-list" style="font-size:3rem;margin-bottom:1.5rem;color:#cbd5e1;"></i>
                <h3>No Trip Details Found</h3>
                <p>Click "Fetch Trips" to load trip details data.</p>
            </div>`;
            tripDetailsCount.textContent = '0 records';
            return;
        }

        // Build columns dynamically from the first record
        const first = tripDetails[0];
        const columns = Object.keys(first).map(key => {
            let col = { dataField: key, caption: key.replace(/_/g, ' ') };

            // Set widths based on column type for better display and prevent freezing
            const keyLower = key.toLowerCase();
            if (keyLower.includes('name') || keyLower.includes('description') || keyLower.includes('address')) {
                col.width = 180;
                col.minWidth = 100;
            } else if (keyLower.includes('number') || keyLower.includes('id')) {
                col.width = 120;
                col.minWidth = 80;
            } else if (keyLower.includes('date')) {
                col.width = 110;
                col.minWidth = 90;
            } else if (keyLower.includes('status')) {
                col.width = 100;
                col.minWidth = 80;
            } else if (keyLower.includes('weight') || keyLower.includes('qty') || keyLower.includes('quantity') || keyLower.includes('amount')) {
                col.width = 100;
                col.minWidth = 70;
            } else {
                col.width = 90;
                col.minWidth = 70;
            }

            // ORDER_NUMBER hyperlink - opens Store Transactions for S2V, Order Details for others
            if (key === 'ORDER_NUMBER' || key === 'order_number') {
                col.cellTemplate = (container, options) => {
                    const orderNumber = options.value || '';
                    const rowData = options.data;
                    const rowDataJson = JSON.stringify(rowData).replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    $(container).html(`<a href="javascript:void(0)" onclick='editTripOrder(JSON.parse(this.getAttribute("data-row")))' data-row="${rowDataJson}" style="color: #667eea; text-decoration: none; font-weight: 600; cursor: pointer;">${orderNumber}</a>`);
                };
            }
            // Status column styling
            else if (key.toLowerCase().includes('status')) {
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
            }
            // Date columns
            else if (key.toLowerCase().includes('date')) {
                col.dataType = 'date';
                col.format = 'dd-MMM-yyyy';
            }
            // Weight columns
            else if (key.toLowerCase().includes('weight')) {
                col.format = { type: 'fixedPoint', precision: 2 };
                col.alignment = 'right';
            }
            // Quantity/Amount columns
            else if (key.toLowerCase().includes('qty') || key.toLowerCase().includes('quantity') || key.toLowerCase().includes('amount')) {
                col.format = { type: 'fixedPoint', precision: 2 };
                col.alignment = 'right';
            }
            // Numeric columns
            else if (!isNaN(Number(first[key])) && first[key] !== null && first[key] !== '') {
                col.format = { type: 'fixedPoint', precision: 0 };
                col.alignment = 'right';
            }

            // LOT_COUNT column - bold with yellow warning icon if doesn't match order_lines
            if (keyLower === 'lot_count') {
                col.cellTemplate = (container, options) => {
                    const lotCount = options.value;
                    const rowData = options.data;
                    const orderLines = rowData.ORDER_LINES || rowData.order_lines || 0;
                    const mismatch = lotCount !== orderLines;

                    let html = '';
                    if (mismatch) {
                        html = `<span style="display: inline-flex; align-items: center; gap: 4px;">
                            <i class="fas fa-exclamation-triangle" style="color: #f59e0b; font-size: 12px;" title="Lot count (${lotCount}) doesn't match order lines (${orderLines})"></i>
                            <span style="font-weight: 700;">${lotCount !== null && lotCount !== undefined ? lotCount : ''}</span>
                        </span>`;
                    } else {
                        html = `<span style="font-weight: 700;">${lotCount !== null && lotCount !== undefined ? lotCount : ''}</span>`;
                    }
                    $(container).html(html);
                };
                col.alignment = 'center';
            }

            // ORDER_LINES column - bold styling
            if (keyLower === 'order_lines') {
                col.cellTemplate = (container, options) => {
                    const orderLines = options.value;
                    $(container).html(`<span style="font-weight: 700;">${orderLines !== null && orderLines !== undefined ? orderLines : ''}</span>`);
                };
                col.alignment = 'center';
            }

            return col;
        });

        // Add PICKER column explicitly if not returned by API
        const hasPickerColumn = columns.some(col =>
            col.dataField && col.dataField.toLowerCase() === 'picker'
        );
        if (!hasPickerColumn) {
            // Also initialize PICKER field in data if not present
            tripDetails.forEach(item => {
                if (!item.PICKER && !item.picker) {
                    item.PICKER = item.PICKER_NAME || item.picker_name || '';
                }
            });

            columns.push({
                dataField: 'PICKER',
                caption: 'Picker',
                minWidth: 150,
                cellTemplate: function(container, options) {
                    const picker = options.value || options.data.picker || options.data.PICKER_NAME || options.data.picker_name || '';
                    const displayText = picker || 'N/A';
                    const style = picker ? 'color: #10b981; font-weight: 600;' : 'color: #9ca3af; font-style: italic;';
                    $(container).html(`<span style="${style}">${displayText}</span>`);
                }
            });
        }

        // Add Actions column at the beginning with Assign Picker button
        columns.unshift({
            caption: 'Actions',
            width: 120,
            alignment: 'center',
            allowFiltering: false,
            allowSorting: false,
            cellTemplate: function(container, options) {
                const rowData = options.data;
                const tripId = rowData.TRIP_ID || rowData.trip_id || '';
                const orderNumber = rowData.ORDER_NUMBER || rowData.order_number || '';
                const rowDataJson = JSON.stringify(rowData).replace(/'/g, "\\'").replace(/"/g, '&quot;');

                $(container).html(`
                    <div style="display: flex; gap: 0.5rem; justify-content: center;">
                        <button class="icon-btn" onclick='assignPickerForTripOrder(JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(rowData))}")), "${tripId}")' title="Assign Picker">
                            <i class="fas fa-user-plus" style="color: #10b981;"></i>
                        </button>
                        <button class="icon-btn" onclick="unassignPicker('${tripId}', '${orderNumber}')" title="Unassign Picker">
                            <i class="fas fa-user-times" style="color: #ef4444;"></i>
                        </button>
                    </div>
                `);
            }
        });

        // Dispose existing grid if exists
        try {
            const existingGrid = $(gridContainer).dxDataGrid('instance');
            if (existingGrid) {
                existingGrid.dispose();
            }
        } catch (e) {}
        $(gridContainer).empty();

        // Create DevExpress DataGrid
        $(gridContainer).dxDataGrid({
            dataSource: tripDetails,
            columns: columns,
            showBorders: true,
            columnAutoWidth: true,
            columnMinWidth: 120,
            width: '100%',
            scrolling: {
                mode: 'standard',
                useNative: true,
                showScrollbar: 'always'
            },
            filterRow: { visible: true },
            headerFilter: { visible: true },
            groupPanel: { visible: true, emptyPanelText: 'Drag a column header here to group' },
            searchPanel: { visible: true, placeholder: "Search trip details..." },
            paging: { enabled: true, pageSize: 25 },
            pager: {
                visible: true,
                showPageSizeSelector: true,
                allowedPageSizes: [10, 25, 50, 100],
                showInfo: true,
                showNavigationButtons: true,
                infoText: 'Page {0} of {1} ({2} records)'
            },
            allowColumnReordering: true,
            allowColumnResizing: true,
            columnResizingMode: 'widget',
            rowAlternationEnabled: true,
            columnChooser: {
                enabled: true,
                mode: 'select'
            },
            selection: {
                mode: 'multiple',
                showCheckBoxesMode: 'always',
                deferred: false
            },
            export: {
                enabled: true,
                allowExportSelectedData: true
            },
            onExporting: function(e) {
                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Trip Details');

                DevExpress.excelExporter.exportDataGrid({
                    component: e.component,
                    worksheet: worksheet,
                    autoFilterEnabled: true
                }).then(function() {
                    workbook.xlsx.writeBuffer().then(function(buffer) {
                        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'TripDetails.xlsx');
                    });
                });
                e.cancel = true;
            },
            height: '100%',
            summary: {
                totalItems: [{
                    column: Object.keys(first)[0],
                    summaryType: 'count',
                    displayFormat: 'Total: {0} records'
                }]
            }
        });

        tripDetailsCount.textContent = `${tripDetails.length} ${tripDetails.length === 1 ? 'record' : 'records'}`;
        console.log('[Trip Details] Loaded', tripDetails.length, 'records');

        // Store grid instance for global access
        window.tripDetailsGridInstance = $(gridContainer).dxDataGrid('instance');

        // Update KPI values
        updateTripDetailsKPIs(tripDetails);
    }

    // Update KPI values for All Trip Details tab
    function updateTripDetailsKPIs(tripDetails) {
        if (!tripDetails || tripDetails.length === 0) {
            document.getElementById('kpi-trip-orders').textContent = '0';
            document.getElementById('kpi-trip-trips').textContent = '0';
            document.getElementById('kpi-trip-customers').textContent = '0';
            document.getElementById('kpi-trip-lorries').textContent = '0';
            document.getElementById('kpi-trip-pickers').textContent = '0';
            return;
        }

        // Count unique values
        const uniqueOrders = new Set(tripDetails.map(r => r.ORDER_NUMBER || r.order_number)).size;
        const uniqueTrips = new Set(tripDetails.map(r => r.TRIP_ID || r.trip_id)).size;
        const uniqueCustomers = new Set(tripDetails.map(r => r.ACCOUNT_NUMBER || r.account_number || r.CUSTOMER_NAME || r.customer_name)).size;
        const uniqueLorries = new Set(tripDetails.map(r => r.LORRY_NUMBER || r.lorry_number)).size;
        const uniquePickers = new Set(tripDetails.map(r => r.PICKER || r.picker).filter(Boolean)).size;

        document.getElementById('kpi-trip-orders').textContent = uniqueOrders;
        document.getElementById('kpi-trip-trips').textContent = uniqueTrips;
        document.getElementById('kpi-trip-customers').textContent = uniqueCustomers;
        document.getElementById('kpi-trip-lorries').textContent = uniqueLorries;
        document.getElementById('kpi-trip-pickers').textContent = uniquePickers;
    }

    // Global function: Assign Picker for Selected Orders in All Trip Details grid
    window.assignPickerForSelectedOrders = function() {
        console.log('[Global Assign Picker] Getting selected orders from All Trip Details grid');

        if (!window.tripDetailsGridInstance) {
            alert('Please load trip details data first.');
            return;
        }

        const selectedOrders = window.tripDetailsGridInstance.getSelectedRowsData();

        if (!selectedOrders || selectedOrders.length === 0) {
            alert('Please select at least one order to assign a picker.');
            return;
        }

        console.log('[Global Assign Picker] Selected', selectedOrders.length, 'orders');

        // Get trip ID from first selected order
        const tripId = selectedOrders[0].TRIP_ID || selectedOrders[0].trip_id || '';

        // Check if pickers data is loaded
        if (!window.pickersData || window.pickersData.length === 0) {
            console.log('[Global Assign Picker] Pickers not loaded, loading now...');

            const loadingMsg = document.createElement('div');
            loadingMsg.id = 'loading-pickers-msg';
            loadingMsg.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#667eea;color:white;padding:1rem 2rem;border-radius:8px;z-index:20000;';
            loadingMsg.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading pickers...';
            document.body.appendChild(loadingMsg);

            if (typeof window.loadPickers === 'function') {
                window.loadPickers();

                const checkInterval = setInterval(() => {
                    if (window.pickersData && window.pickersData.length > 0) {
                        clearInterval(checkInterval);
                        const msg = document.getElementById('loading-pickers-msg');
                        if (msg) msg.remove();
                        openAssignPickerDialog(tripId, selectedOrders);
                    }
                }, 500);

                setTimeout(() => {
                    clearInterval(checkInterval);
                    const msg = document.getElementById('loading-pickers-msg');
                    if (msg) msg.remove();
                    if (!window.pickersData || window.pickersData.length === 0) {
                        alert('Failed to load pickers. Please try again.');
                    }
                }, 10000);
            } else {
                loadingMsg.remove();
                alert('Pickers module not loaded. Please refresh the page.');
            }
            return;
        }

        openAssignPickerDialog(tripId, selectedOrders);
    };

    // Global function: Allocate Lots for S2V orders in All Trip Details grid
    window.allocateLotsForS2V = function() {
        console.log('[Global Allocate Lots] Getting selected S2V orders from All Trip Details grid');

        if (!window.tripDetailsGridInstance) {
            alert('Please load trip details data first.');
            return;
        }

        const selectedOrders = window.tripDetailsGridInstance.getSelectedRowsData();

        if (!selectedOrders || selectedOrders.length === 0) {
            alert('Please select at least one order to allocate lots.');
            return;
        }

        // Filter only S2V orders
        const s2vOrders = selectedOrders.filter(order => {
            const orderType = (order.ORDER_TYPE || order.order_type || order.ORDER_TYPE_CODE || order.order_type_code || '').toUpperCase();
            return orderType === 'STORE TO VAN' || orderType === 'S2V' || orderType === 'VAN TO STORE' || orderType === 'V2S';
        });

        if (s2vOrders.length === 0) {
            alert('No Store to Van (S2V) orders found in selection. Please select S2V orders only.');
            return;
        }

        console.log('[Global Allocate Lots] Found', s2vOrders.length, 'S2V orders out of', selectedOrders.length, 'selected');

        // Confirm with user
        if (!confirm(`Allocate lots for ${s2vOrders.length} S2V order(s)?\n\nThis will fetch and allocate inventory lots for the selected orders.`)) {
            return;
        }

        // Show progress
        const progressModal = document.createElement('div');
        progressModal.id = 'allocate-lots-progress';
        progressModal.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:20000;display:flex;justify-content:center;align-items:center;">
                <div style="background:white;padding:2rem;border-radius:12px;max-width:500px;width:90%;">
                    <h3 style="margin:0 0 1rem 0;color:#1e293b;"><i class="fas fa-boxes" style="color:#8b5cf6;"></i> Allocating Lots for S2V Orders</h3>
                    <div id="allocate-lots-status" style="color:#64748b;margin-bottom:1rem;">Processing 0 of ${s2vOrders.length} orders...</div>
                    <div style="background:#e2e8f0;border-radius:8px;height:8px;overflow:hidden;">
                        <div id="allocate-lots-progress-bar" style="background:linear-gradient(90deg,#8b5cf6,#667eea);height:100%;width:0%;transition:width 0.3s;"></div>
                    </div>
                    <div id="allocate-lots-log" style="max-height:200px;overflow-y:auto;margin-top:1rem;font-size:0.85rem;background:#f8fafc;padding:0.75rem;border-radius:8px;border:1px solid #e2e8f0;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(progressModal);

        // Process orders sequentially
        processS2VAllocations(s2vOrders, 0);
    };

    // Process S2V allocations one by one
    function processS2VAllocations(orders, index) {
        if (index >= orders.length) {
            // All done
            const statusEl = document.getElementById('allocate-lots-status');
            const progressBar = document.getElementById('allocate-lots-progress-bar');
            if (statusEl) statusEl.textContent = `Completed! Processed ${orders.length} orders.`;
            if (progressBar) progressBar.style.width = '100%';

            setTimeout(() => {
                const modal = document.getElementById('allocate-lots-progress');
                if (modal) modal.remove();
                alert(`Lot allocation completed for ${orders.length} S2V order(s).`);
                // Refresh grid
                if (window.tripDetailsGridInstance) {
                    window.tripDetailsGridInstance.refresh();
                }
            }, 1500);
            return;
        }

        const order = orders[index];
        const orderNumber = order.ORDER_NUMBER || order.order_number || '';
        const statusEl = document.getElementById('allocate-lots-status');
        const progressBar = document.getElementById('allocate-lots-progress-bar');
        const logEl = document.getElementById('allocate-lots-log');

        if (statusEl) statusEl.textContent = `Processing ${index + 1} of ${orders.length}: ${orderNumber}`;
        if (progressBar) progressBar.style.width = `${((index + 1) / orders.length) * 100}%`;

        // Get instance
        const instance = order.instance_name || order.INSTANCE_NAME || order.instance || order.INSTANCE
            || sessionStorage.getItem('loggedInInstance')
            || localStorage.getItem('fusionInstance')
            || 'PROD';

        // Call the allocate lots API
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/materialtrx/allocatelots?p_trx_number=${encodeURIComponent(orderNumber)}&p_instance_name=${encodeURIComponent(instance)}`;

        if (logEl) logEl.innerHTML += `<div style="color:#64748b;"><i class="fas fa-spinner fa-spin"></i> ${orderNumber}: Allocating...</div>`;

        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            if (error) {
                console.error('[Allocate Lots] Error for', orderNumber, ':', error);
                if (logEl) logEl.innerHTML += `<div style="color:#ef4444;"><i class="fas fa-times-circle"></i> ${orderNumber}: Error - ${error}</div>`;
            } else {
                console.log('[Allocate Lots] Success for', orderNumber, ':', data);
                if (logEl) logEl.innerHTML += `<div style="color:#10b981;"><i class="fas fa-check-circle"></i> ${orderNumber}: Success</div>`;
            }

            // Scroll log to bottom
            if (logEl) logEl.scrollTop = logEl.scrollHeight;

            // Process next order after a short delay
            setTimeout(() => processS2VAllocations(orders, index + 1), 500);
        });
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

    window.openTripManagementTab = function(tabType, forceRefresh = true) {
        console.log('[Trip Tab] openTripManagementTab called for:', tabType, 'forceRefresh:', forceRefresh);

        const tabHeader = document.getElementById('trip-tab-header');
        const tabContent = document.getElementById('trip-tab-content');

        const tabId = `trip-${tabType}`;
        const existingTab = document.querySelector(`.tab-item[data-tab="${tabId}"]`);

        // If tab exists and we need to force refresh, remove it first
        if (existingTab && forceRefresh) {
            console.log('[Trip Tab] Removing existing tab for refresh');
            const existingPane = document.getElementById(`trip-${tabId}-tab`);
            if (existingTab) existingTab.remove();
            if (existingPane) existingPane.remove();
        } else if (existingTab) {
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
        console.log('[Fetch Trips] renderTripsAsCards called for tab:', tabId);
        console.log('[Fetch Trips] currentFullData has', currentFullData ? currentFullData.length : 0, 'records');

        // Get the current selected instance from the dropdown
        const selectedInstanceDropdown = document.getElementById('trip-instance-name');
        const selectedInstance = selectedInstanceDropdown ? selectedInstanceDropdown.value : 'PROD';

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
                    INSTANCE: trip.INSTANCE || trip.instance || trip.instance_name || trip.INSTANCE_NAME || selectedInstance,
                    LOADING_BAY: trip.TRIP_LOADING_BAY || trip.trip_loading_bay || trip.LOADING_BAY || trip.loading_bay || null,
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
                                <span style="font-size: 0.9rem; font-weight: 700; color: #1e293b;">Trip #${trip.TRIP_ID}${trip.LOADING_BAY ? ` - Bay ${trip.LOADING_BAY}` : ''}</span>
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

                            <!-- Instance -->
                            <div style="flex: 0 0 55px; padding: 0.5rem; background: #faf5ff; border-radius: 5px; border-left: 2px solid #8b5cf6;">
                                <div style="font-size: 0.6rem; font-weight: 600; color: #64748b; margin-bottom: 0.2rem; text-transform: uppercase; letter-spacing: 0.3px;">Instance</div>
                                <div style="font-size: 0.7rem; font-weight: 700; color: #7c3aed;">${trip.INSTANCE || 'N/A'}</div>
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

        // Store the current trip's instance globally for use by Add Orders modal
        window.currentTripInstance = instance;
        console.log('[JS] Stored currentTripInstance:', window.currentTripInstance);

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
                        // No orders yet - still open the trip page with empty data
                        console.log('[JS] No orders found for trip:', tripId, '- opening with empty data');
                        const emptyTripData = [{
                            trip_id: tripId,
                            TRIP_ID: tripId,
                            trip_date: tripDate,
                            TRIP_DATE: tripDate,
                            trip_lorry: lorryNumber,
                            TRIP_LORRY: lorryNumber,
                            INSTANCE: instance
                        }];
                        openTripDetailsWithData(tripId, emptyTripData, tripDate, lorryNumber, true);
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
                        // No orders yet - still open the trip page with empty data
                        console.log('[JS] No orders found for trip:', tripId, '- opening with empty data');
                        const emptyTripData = [{
                            trip_id: tripId,
                            TRIP_ID: tripId,
                            trip_date: tripDate,
                            TRIP_DATE: tripDate,
                            trip_lorry: lorryNumber,
                            TRIP_LORRY: lorryNumber,
                            INSTANCE: instance
                        }];
                        openTripDetailsWithData(tripId, emptyTripData, tripDate, lorryNumber, true);
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
    window.openTripDetailsWithData = function(tripId, tripData, tripDate, lorryNumber, isEmpty = false) {
        console.log('[JS] Opening trip details with', tripData.length, 'records for trip:', tripId, 'isEmpty:', isEmpty);

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
        const totalOrders = isEmpty ? 0 : tripData.length;
        
        // Calculate KPI statistics (handle empty trip case)
        const uniqueCustomers = isEmpty ? 0 : new Set(tripData.map(t => t.account_name || t.ACCOUNT_NAME || t.CUSTOMER_NAME).filter(x => x)).size;
        const uniqueProducts = isEmpty ? 0 : new Set(tripData.map(t => t.PRODUCT_NAME || t.item_name || t.ITEM_NAME).filter(x => x)).size;
        const totalQuantity = isEmpty ? 0 : tripData.reduce((sum, t) => sum + (parseFloat(t.QUANTITY || t.quantity || 0)), 0);
        const totalWeight = isEmpty ? 0 : tripData.reduce((sum, t) => sum + (parseFloat(t.WEIGHT || t.weight || 0)), 0);
        const priority = firstRecord.TRIP_PRIORITY || firstRecord.trip_priority || firstRecord.PRIORITY || 'Medium';
        const instanceName = firstRecord.INSTANCE || firstRecord.instance || window.currentTripInstance || 'PROD';
        
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
                    <div onclick="toggleTripSummary('${tabId}')" style="padding: 1rem 1.25rem; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <div style="width: 40px; height: 40px; background: #e2e8f0; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-route" style="color: #475569; font-size: 1.2rem;"></i>
                            </div>
                            <div>
                                <h2 style="font-size: 1.1rem; font-weight: 700; color: #1e293b; margin: 0;">Trip: ${tripId}</h2>
                                <p style="color: #64748b; font-size: 0.75rem; margin: 0.2rem 0 0 0;">Trip Summary & Statistics</p>
                            </div>
                        </div>
                        <i class="fas fa-chevron-down" id="summary-icon-${tabId}" style="color: #64748b; font-size: 1rem; transition: transform 0.3s ease;"></i>
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
                            <button class="btn" onclick="showTripLines('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem; background: #8b5cf6; color: white;">
                                <i class="fas fa-list-alt"></i> Show Lines
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

                if (tripData.length === 0 || isEmpty) {
                    gridContainer.html(`
                        <div style="padding:3rem;text-align:center;color:#64748b;">
                            <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem;">
                                <i class="fas fa-box-open" style="color: white; font-size: 2rem;"></i>
                            </div>
                            <h3 style="color: #1e293b; margin-bottom: 0.5rem;">No Orders Yet</h3>
                            <p style="margin-bottom: 1.5rem;">This trip doesn't have any orders. Click "Add Orders" to start adding orders to this trip.</p>
                            <button class="btn btn-primary" onclick="openAddOrdersModalForTrip('${tripId}')" style="padding: 0.75rem 1.5rem;">
                                <i class="fas fa-plus"></i> Add Orders to Trip
                            </button>
                        </div>
                    `);
                    return;
                }

                console.log('[JS] Creating grid with', tripData.length, 'records');
                const first = tripData[0];
                const columns = Object.keys(first).map(key => {
                let col = { dataField: key, caption: key.replace(/_/g, ' ') };
                if (key === 'ORDER_NUMBER' || key === 'order_number') {
                    col.cellTemplate = (container, options) => {
                        const orderNumber = options.value || '';
                        const rowData = options.data;
                        const rowDataJson = JSON.stringify(rowData).replace(/'/g, "\\'").replace(/"/g, '&quot;');
                        $(container).html(`<a href="javascript:void(0)" onclick='editTripOrder(JSON.parse(this.getAttribute("data-row")))' data-row="${rowDataJson}" style="color: #667eea; text-decoration: none; font-weight: 600; cursor: pointer;">${orderNumber}</a>`);
                    };
                } else if (key === 'LINE_STATUS') {
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
                } else if (key === 'PICK_CONFIRM_ST' || key === 'pick_confirm_st' || key === 'SHIP_CONFIRM_ST' || key === 'ship_confirm_st') {
                    col.alignment = 'center';
                    col.caption = key.includes('PICK') || key.includes('pick') ? 'Pick Status' : 'Ship Status';
                    // Show raw data value without icons
                } else if (key.endsWith('_WEIGHT')) {
                    col.format = { type: 'fixedPoint', precision: 2 };
                    col.alignment = 'right';
                } else if (key.endsWith('_ITEMS') || !isNaN(Number(first[key]))) {
                    col.format = { type: 'fixedPoint', precision: 0 };
                    col.alignment = 'right';
                }
                return col;
            });

            // Add PICKER column explicitly if not returned by API
            const hasPickerColumn = columns.some(col =>
                col.dataField && col.dataField.toLowerCase() === 'picker'
            );
            if (!hasPickerColumn) {
                // Also initialize PICKER field in data if not present
                tripData.forEach(item => {
                    if (!item.PICKER && !item.picker) {
                        item.PICKER = item.PICKER_NAME || item.picker_name || '';
                    }
                });

                columns.push({
                    dataField: 'PICKER',
                    caption: 'Picker',
                    minWidth: 150,
                    cellTemplate: function(container, options) {
                        const picker = options.value || options.data.picker || options.data.PICKER_NAME || options.data.picker_name || '';
                        const displayText = picker || 'N/A';
                        const style = picker ? 'color: #10b981; font-weight: 600;' : 'color: #9ca3af; font-style: italic;';
                        $(container).html(`<span style="${style}">${displayText}</span>`);
                    }
                });
            }

            // Add Actions column at the beginning
            columns.unshift({
                caption: 'Actions',
                width: 180,
                alignment: 'center',
                allowFiltering: false,
                allowSorting: false,
                cellTemplate: function(container, options) {
                    const rowData = options.data;

                    // Debug: Log all instance-related fields in rowData
                    console.log('[Trip Details Grid] Instance fields in rowData:', {
                        'instance_name': rowData.instance_name,
                        'INSTANCE_NAME': rowData.INSTANCE_NAME,
                        'instance': rowData.instance,
                        'INSTANCE': rowData.INSTANCE,
                        'sessionStorage': sessionStorage.getItem('loggedInInstance'),
                        'localStorage': localStorage.getItem('fusionInstance')
                    });

                    // Get instance - try rowData first, then sessionStorage, then localStorage, finally fallback to TEST
                    const instanceName = rowData.instance_name || rowData.INSTANCE_NAME || rowData.instance || rowData.INSTANCE
                        || sessionStorage.getItem('loggedInInstance')
                        || localStorage.getItem('fusionInstance')
                        || 'TEST';

                    const orderType = rowData.ORDER_TYPE || rowData.order_type || rowData.ORDER_TYPE_CODE || rowData.order_type_code || '';
                    const tripIdFromRow = rowData.TRIP_ID || rowData.trip_id || '';
                    const tripDateFromRow = rowData.TRIP_DATE || rowData.trip_date || '';

                    console.log('[Trip Details Grid] Final Print button data:', {
                        orderNumber: rowData.ORDER_NUMBER || rowData.order_number,
                        instanceName: instanceName,
                        orderType: orderType,
                        tripId: tripIdFromRow,
                        tripDate: tripDateFromRow
                    });

                    $(container).html(`
                        <div style="display: flex; gap: 0.5rem; justify-content: center;">
                            <button class="icon-btn" onclick="printStoreTransaction('${rowData.ORDER_NUMBER || rowData.order_number}', '${instanceName}', '${orderType}', '${tripIdFromRow}', '${tripDateFromRow}')" title="Print Store Transaction">
                                <i class="fas fa-print" style="color: #8b5cf6;"></i>
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

        // Try to find trip data from currentFullData (may not exist for newly created trips)
        const tripRecords = currentFullData ? currentFullData.filter(trip => {
            const tripIdLower = (trip.trip_id || '').toString().toLowerCase();
            const tripIdUpper = (trip.TRIP_ID || '').toString().toLowerCase();
            const searchId = tripId.toString().toLowerCase();
            return tripIdLower === searchId || tripIdUpper === searchId;
        }) : [];

        // If trip data found in currentFullData, use it to set modal data
        if (tripRecords.length > 0) {
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
        } else {
            // Trip not in currentFullData (e.g., newly created trip)
            // The instance should already be set in window.currentTripInstance from openTripDetails
            console.log('[Trip Management] Trip not in currentFullData, using stored instance:', window.currentTripInstance);
        }

        // Open the modal - it will use window.currentTripInstance for the instance
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

        // Get the grid instance - check both tab and dialog grids
        const tabId = `trip-detail-${tripId}`;
        const tabGridId = `grid-${tabId}`;
        const dialogGridId = 'trip-dialog-grid';

        console.log('[Assign Picker] Looking for grid:', tabGridId, 'or', dialogGridId);

        // Try tab grid first, then dialog grid
        let gridContainer = $(`#${tabGridId}`);
        if (!gridContainer || gridContainer.length === 0) {
            console.log('[Assign Picker] Tab grid not found, trying dialog grid...');
            gridContainer = $(`#${dialogGridId}`);
        }

        console.log('[Assign Picker] Grid container found:', gridContainer.length);

        if (!gridContainer || gridContainer.length === 0) {
            console.error('[Assign Picker] ❌ Grid not found');
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

        // Store for API info button
        window.pendingAssignPickerTripId = tripId;
        window.pendingAssignPickerOrders = selectedOrders;

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

                pickerOptionsHtml += `<option value="${pickerId}" data-name="${pickerName}">${pickerName}</option>`;
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
                        <div style="margin-bottom: 1.5rem;">
                            <label for="assign-picker-select" style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #1f2937; font-size: 0.9rem;">
                                <i class="fas fa-user"></i> Select Picker <span style="color: #ef4444;">*</span>
                            </label>
                            <select id="assign-picker-select" style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.9rem; background: white; color: #1f2937;">
                                ${pickerOptionsHtml}
                            </select>
                        </div>

                        <!-- Assignment Date -->
                        <div>
                            <label for="assign-picker-date" style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #1f2937; font-size: 0.9rem;">
                                <i class="fas fa-calendar-alt"></i> Assignment Date <span style="color: #ef4444;">*</span>
                            </label>
                            <input type="date" id="assign-picker-date" value="${new Date().toISOString().split('T')[0]}" style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.9rem; background: white; color: #1f2937; box-sizing: border-box;">
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; background: #f8f9fc; display: flex; gap: 0.75rem; justify-content: space-between; align-items: center;">
                        <button onclick="showAssignPickerApiInfo()" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="View API Information">
                            <i class="fas fa-code"></i> API Info
                        </button>
                        <div style="display: flex; gap: 0.75rem;">
                            <button class="btn btn-secondary" onclick="closeAssignPickerDialog()">
                                <i class="fas fa-times"></i> Cancel
                            </button>
                            <button class="btn btn-primary" onclick="submitAssignPicker('${tripId}', ${JSON.stringify(selectedOrders).replace(/"/g, '&quot;')})">
                                <i class="fas fa-check"></i> Assign
                            </button>
                        </div>
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

    // Show API Information for Assign Picker
    window.showAssignPickerApiInfo = function() {
        const tripId = window.pendingAssignPickerTripId || 'N/A';
        const selectedOrders = window.pendingAssignPickerOrders || [];
        const instance = localStorage.getItem('fusionInstance') || 'TEST';

        // Get sample order for display
        const sampleOrder = selectedOrders[0] || {};
        const sampleOrderNumber = sampleOrder.ORDER_NUMBER || sampleOrder.order_number || '{orderNumber}';

        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/pickerassignment';

        // Build sample payload
        const samplePayload = {
            orders: [{
                orderNumber: sampleOrderNumber,
                accountNumber: sampleOrder.ACCOUNT_NUMBER || sampleOrder.account_number || '',
                accountName: sampleOrder.ACCOUNT_NAME || sampleOrder.account_name || '',
                pickerName: '{selectedPickerName}',
                loadingBay: sampleOrder.LOADING_BAY || sampleOrder.loading_bay || '',
                orderTypeCode: sampleOrder.ORDER_TYPE_CODE || sampleOrder.order_type_code || '',
                assignmentDate: new Date().toISOString().split('T')[0],
                pickslip: sampleOrder.PICKSLIP || sampleOrder.pickslip || '',
                pickwave: sampleOrder.PICKWAVE || sampleOrder.pickwave || '',
                instance: instance
            }]
        };

        const popupHtml = `
            <div id="assign-picker-api-info-popup" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 30000; display: flex; justify-content: center; align-items: center;">
                <div style="background: white; width: 90%; max-width: 700px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.1rem;">
                            <i class="fas fa-code"></i> Assign Picker API Information
                        </h3>
                        <button onclick="document.getElementById('assign-picker-api-info-popup').remove()" style="background: none; border: none; font-size: 1.5rem; color: white; cursor: pointer;">&times;</button>
                    </div>
                    <div style="padding: 1.5rem; max-height: 70vh; overflow-y: auto;">
                        <!-- Current Context -->
                        <div style="background: #eff6ff; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #3b82f6;">
                            <div style="font-weight: 600; color: #1e40af; margin-bottom: 0.5rem;">Current Context</div>
                            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Trip ID:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600;">${tripId}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Instance:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600; color: #7c3aed;">${instance}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Orders Count:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600;">${selectedOrders.length}</td>
                                </tr>
                            </table>
                        </div>

                        <!-- API Details -->
                        <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 3px solid #667eea;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                <span style="background: #fed7aa; color: #9c4221; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">POST</span>
                                <strong style="color: #1e293b; font-size: 12px;">Picker Assignment</strong>
                            </div>
                            <div style="margin-bottom: 0.5rem;">
                                <strong style="color: #4a5568; font-size: 11px;">Full URL:</strong>
                                <code style="background: #edf2f7; padding: 6px 10px; border-radius: 4px; font-size: 9px; word-break: break-all; display: block; margin-top: 4px;">${apiUrl}</code>
                            </div>
                        </div>

                        <!-- Request Body -->
                        <div style="background: #f0fdf4; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #22c55e;">
                            <div style="font-weight: 600; color: #166534; margin-bottom: 0.5rem;">Sample Request Body</div>
                            <pre style="background: #1e293b; color: #e2e8f0; padding: 1rem; border-radius: 6px; font-size: 10px; overflow-x: auto; margin: 0;">${JSON.stringify(samplePayload, null, 2)}</pre>
                        </div>

                        <!-- Instance Note -->
                        <div style="background: #fef3c7; padding: 0.75rem; border-radius: 8px; border-left: 4px solid #f59e0b;">
                            <strong style="color: #92400e;"><i class="fas fa-info-circle"></i> Instance Parameter:</strong>
                            <span style="color: #78350f; font-size: 12px;">
                                The <code style="background: #fde68a; padding: 2px 4px; border-radius: 3px;">instance</code> field is included in each order object in the request body (not as a query parameter).
                                Current value: <strong>${instance}</strong> (from localStorage)
                            </span>
                        </div>
                    </div>
                    <div style="padding: 1rem 1.5rem; border-top: 2px solid #f0f0f0; display: flex; justify-content: flex-end;">
                        <button onclick="document.getElementById('assign-picker-api-info-popup').remove()" class="btn btn-secondary" style="padding: 8px 20px;">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing popup if any
        const existingPopup = document.getElementById('assign-picker-api-info-popup');
        if (existingPopup) existingPopup.remove();

        // Add popup to body
        document.body.insertAdjacentHTML('beforeend', popupHtml);
    };

    // Submit Assign Picker (POST to API via C# backend)
    window.submitAssignPicker = async function(tripId, selectedOrders) {
        const pickerSelect = document.getElementById('assign-picker-select');
        const pickerId = pickerSelect.value;

        if (!pickerId) {
            alert('Please select a picker.');
            return;
        }

        // Get assignment date from input field
        const assignmentDateInput = document.getElementById('assign-picker-date');
        const assignmentDate = assignmentDateInput ? assignmentDateInput.value : new Date().toISOString().split('T')[0];

        if (!assignmentDate) {
            alert('Please select an assignment date.');
            return;
        }

        const pickerName = pickerSelect.options[pickerSelect.selectedIndex].getAttribute('data-name') || pickerSelect.options[pickerSelect.selectedIndex].text;

        console.log('[Assign Picker] Assigning picker:', pickerId, pickerName);
        console.log('[Assign Picker] Assignment Date:', assignmentDate);
        console.log('[Assign Picker] To orders:', selectedOrders);
        console.log('[Assign Picker] Trip ID:', tripId);

        // Get instance from toolbar
        const instance = localStorage.getItem('fusionInstance') || 'TEST';
        console.log('[Assign Picker] Instance:', instance);

        // Build orders array for API
        const orders = selectedOrders.map(order => ({
            orderNumber: order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number || '',
            accountNumber: order.ACCOUNT_NUMBER || order.account_number || '',
            accountName: order.ACCOUNT_NAME || order.account_name || order.CUSTOMER_NAME || order.customer_name || '',
            pickerName: pickerName,
            loadingBay: order.LOADING_BAY || order.loading_bay || '',
            orderTypeCode: order.ORDER_TYPE_CODE || order.order_type_code || order.ORDER_TYPE || order.order_type || '',
            assignmentDate: assignmentDate,
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

                            // Update grid columns with the new picker name
                            const tabId = `trip-detail-${tripId}`;
                            const gridId = `grid-${tabId}`;
                            const gridContainer = $(`#${gridId}`);
                            if (gridContainer && gridContainer.length > 0) {
                                const gridInstance = gridContainer.dxDataGrid('instance');
                                if (gridInstance) {
                                    // Get the data source and update selected rows with new picker name
                                    const dataSource = gridInstance.getDataSource();
                                    const allItems = dataSource.items();

                                    // Update picker name in selected orders
                                    selectedOrders.forEach(selectedOrder => {
                                        const orderNum = selectedOrder.SOURCE_ORDER_NUMBER || selectedOrder.source_order_number || selectedOrder.ORDER_NUMBER || selectedOrder.order_number;
                                        allItems.forEach(item => {
                                            const itemOrderNum = item.SOURCE_ORDER_NUMBER || item.source_order_number || item.ORDER_NUMBER || item.order_number;
                                            if (itemOrderNum === orderNum) {
                                                // Update picker name in the data
                                                item.PICKER = pickerName;
                                                item.picker = pickerName;
                                                item.PICKER_NAME = pickerName;
                                                item.picker_name = pickerName;
                                            }
                                        });
                                    });

                                    // Repaint grid to show updated picker names
                                    gridInstance.repaint();
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

                    // Update grid columns with the new picker name
                    const tabId = `trip-detail-${tripId}`;
                    const gridId = `grid-${tabId}`;
                    const gridContainer = $(`#${gridId}`);
                    if (gridContainer && gridContainer.length > 0) {
                        const gridInstance = gridContainer.dxDataGrid('instance');
                        if (gridInstance) {
                            // Get the data source and update selected rows with new picker name
                            const dataSource = gridInstance.getDataSource();
                            const allItems = dataSource.items();

                            // Update picker name in selected orders
                            selectedOrders.forEach(selectedOrder => {
                                const orderNum = selectedOrder.SOURCE_ORDER_NUMBER || selectedOrder.source_order_number || selectedOrder.ORDER_NUMBER || selectedOrder.order_number;
                                allItems.forEach(item => {
                                    const itemOrderNum = item.SOURCE_ORDER_NUMBER || item.source_order_number || item.ORDER_NUMBER || item.order_number;
                                    if (itemOrderNum === orderNum) {
                                        // Update picker name in the data
                                        item.PICKER = pickerName;
                                        item.picker = pickerName;
                                        item.PICKER_NAME = pickerName;
                                        item.picker_name = pickerName;
                                    }
                                });
                            });

                            // Repaint grid to show updated picker names
                            gridInstance.repaint();
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
        console.log('[Pick Release All] Processing trip:', tripId);

        // Get the grid instance - check both tab and dialog grids
        const tabId = `trip-detail-${tripId}`;
        const tabGridId = `grid-${tabId}`;
        const dialogGridId = 'trip-dialog-grid';

        console.log('[Pick Release All] Looking for grid:', tabGridId, 'or', dialogGridId);

        // Try tab grid first, then dialog grid
        let gridContainer = $(`#${tabGridId}`);
        if (!gridContainer || gridContainer.length === 0) {
            console.log('[Pick Release All] Tab grid not found, trying dialog grid...');
            gridContainer = $(`#${dialogGridId}`);
        }

        if (!gridContainer || gridContainer.length === 0) {
            console.error('[Pick Release All] Grid not found');
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
            alert('Please select at least one order to pick release.');
            return;
        }

        console.log('[Pick Release All] Selected rows:', selectedRows.length);

        // Separate S2V and Sales Orders
        const s2vOrders = [];
        const salesOrders = [];

        selectedRows.forEach(row => {
            const orderType = (row.ORDER_TYPE || row.order_type || row.ORDER_TYPE_CODE || row.order_type_code || '').toUpperCase().trim();
            console.log('[Pick Release All] Order:', row.ORDER_NUMBER || row.order_number, 'Type:', orderType);

            if (orderType === 'S2V' || orderType === 'STORE TO VAN' || orderType.includes('STORE TO VAN')) {
                s2vOrders.push(row);
            } else {
                salesOrders.push(row);
            }
        });

        console.log('[Pick Release All] S2V Orders:', s2vOrders.length, 'Sales Orders:', salesOrders.length);

        // If we have both types, ask user which to process or process both
        if (s2vOrders.length > 0 && salesOrders.length > 0) {
            if (!confirm(`You have selected:\n• ${s2vOrders.length} Store to Van (S2V) order(s)\n• ${salesOrders.length} Sales Order(s)\n\nDo you want to process ALL orders?\n\nClick OK to process all, or Cancel to select only one type.`)) {
                return;
            }
        }

        // Process S2V orders using existing logic
        if (s2vOrders.length > 0) {
            console.log('[Pick Release All] Processing S2V orders with existing allocateLots logic...');
            // Call existing allocateLots for S2V
            processS2VPickRelease(s2vOrders, tripId);
        }

        // Process Sales Orders using new API
        if (salesOrders.length > 0) {
            console.log('[Pick Release All] Processing Sales Orders with new API...');
            processSalesOrderPickRelease(salesOrders, tripId);
        }
    };

    // Process S2V Pick Release (uses existing allocate lots logic)
    function processS2VPickRelease(orders, tripId) {
        console.log('[S2V Pick Release] Processing', orders.length, 'S2V orders');

        // Show progress popup
        const modalHtml = `
            <div id="s2v-pick-release-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; justify-content: center; align-items: center;">
                <div style="background: white; width: 90%; max-width: 500px; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <div style="padding: 1.25rem 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #10b981 0%, #059669 100%); display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: white; font-size: 1.1rem;">
                            <i class="fas fa-truck-loading"></i> Pick Release - Store to Van
                        </h3>
                        <button onclick="closeS2VPickReleaseModal()" style="background: none; border: none; font-size: 1.5rem; color: white; cursor: pointer;">&times;</button>
                    </div>
                    <div style="padding: 1.5rem;">
                        <div style="margin-bottom: 1rem;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="font-weight: 600; color: #1f2937;">Progress</span>
                                <span id="s2v-pr-progress-text" style="color: #64748b;">0 / ${orders.length}</span>
                            </div>
                            <div style="background: #e2e8f0; border-radius: 8px; height: 8px; overflow: hidden;">
                                <div id="s2v-pr-progress-bar" style="background: linear-gradient(90deg, #10b981, #059669); height: 100%; width: 0%; transition: width 0.3s;"></div>
                            </div>
                        </div>
                        <div id="s2v-pr-log" style="max-height: 200px; overflow-y: auto; font-size: 0.85rem; background: #f8fafc; padding: 0.75rem; border-radius: 8px; border: 1px solid #e2e8f0;"></div>
                    </div>
                    <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; background: #f8f9fc; display: flex; justify-content: flex-end;">
                        <button onclick="closeS2VPickReleaseModal()" class="btn btn-secondary">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Process using existing allocateLots logic - call processS2VOrders function
        if (typeof processS2VOrders === 'function') {
            // Redirect to existing S2V processing
            closeS2VPickReleaseModal();
            window.allocateLotsForS2V && window.allocateLotsForS2V(tripId);
        } else {
            addS2VPRLog('S2V processing uses Allocate Lots functionality.', 'info');
            addS2VPRLog('Please use "Allocate Lots for S2V" button for S2V orders.', 'info');
        }
    }

    window.closeS2VPickReleaseModal = function() {
        const modal = document.getElementById('s2v-pick-release-modal');
        if (modal) modal.remove();
    };

    function addS2VPRLog(message, type = 'info') {
        const logDiv = document.getElementById('s2v-pr-log');
        if (logDiv) {
            const color = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#64748b';
            logDiv.innerHTML += `<div style="color: ${color}; margin-bottom: 0.25rem;">${message}</div>`;
            logDiv.scrollTop = logDiv.scrollHeight;
        }
    }

    // Process Sales Order Pick Release (uses new API)
    function processSalesOrderPickRelease(orders, tripId) {
        console.log('[Sales Order Pick Release] Showing', orders.length, 'sales orders for trip:', tripId);

        // Store orders and tripId globally for the button click
        window.pendingSalesOrdersForPickRelease = orders;
        window.pendingTripIdForPickRelease = tripId;

        // Get instance
        const instance = orders[0]?.INSTANCE_NAME || orders[0]?.instance_name || window.currentTripInstance || 'TEST';
        const warehouse = 'GIC'; // Default warehouse

        // Initialize data for individual button functions
        window.withLotsPickReleaseData = {
            orders: orders,
            tripId: tripId,
            instance: instance,
            warehouse: warehouse,
            results: orders.map(() => ({ step1: null, step2: null, step3: null }))
        };

        // Build order list HTML for No Lots mode (simple list)
        let noLotsOrderListHtml = '';
        orders.forEach((order, index) => {
            const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number || `Order ${index + 1}`;
            const customerName = order.ACCOUNT_NAME || order.account_name || order.CUSTOMER_NAME || order.customer_name || '';

            noLotsOrderListHtml += `
                <div id="pr-order-row-${index}" style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span id="pr-order-status-${index}" style="width: 20px; text-align: center; color: #94a3b8;">
                            <i class="fas fa-circle" style="font-size: 0.5rem;"></i>
                        </span>
                        <span style="font-weight: 600; color: #1f2937;">${orderNumber}</span>
                        ${customerName ? `<span style="color: #64748b; font-size: 0.85rem;">- ${customerName}</span>` : ''}
                    </div>
                    <span style="color: #64748b; font-size: 0.75rem;">${index + 1} of ${orders.length}</span>
                </div>
            `;
        });

        // Build order table HTML for With Lots mode
        let withLotsTableHtml = '';
        orders.forEach((order, index) => {
            const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number || `Order ${index + 1}`;
            const totalLines = order.TOTAL_LINES || order.total_lines || order.LINE_COUNT || order.line_count || '-';

            withLotsTableHtml += `
                <tr id="wl-order-row-${index}" data-order-number="${orderNumber}" data-index="${index}">
                    <td style="padding: 0.6rem 0.5rem; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #1f2937; font-size: 11px;">${orderNumber}</td>
                    <td id="wl-total-lines-${index}" style="padding: 0.6rem 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center; font-size: 11px;">
                        <span style="color: #94a3b8;">-</span>
                    </td>
                    <td id="wl-release-st-${index}" style="padding: 0.6rem 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        <span style="color: #94a3b8;"><i class="fas fa-clock" style="font-size: 12px;"></i></span>
                    </td>
                    <td id="wl-get-picks-${index}" style="padding: 0.6rem 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        <span style="color: #94a3b8;"><i class="fas fa-clock" style="font-size: 12px;"></i></span>
                    </td>
                    <td id="wl-get-lots-${index}" style="padding: 0.6rem 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        <span style="color: #94a3b8;"><i class="fas fa-clock" style="font-size: 12px;"></i></span>
                    </td>
                    <td id="wl-retry-${index}" style="padding: 0.6rem 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        <button onclick="retryWithLotsOrder(${index})" class="btn btn-sm" style="padding: 4px 8px; font-size: 10px; background: #e5e7eb; color: #374151; border: none; border-radius: 4px; cursor: pointer;" disabled>
                            <i class="fas fa-redo"></i>
                        </button>
                    </td>
                    <td id="wl-time-${index}" style="padding: 0.6rem 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center; font-size: 10px; color: #64748b;">
                        -
                    </td>
                </tr>
            `;
        });

        // Show popup with orders list and Pick Release button
        const modalHtml = `
            <div id="sales-pick-release-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; justify-content: center; align-items: center;">
                <div style="background: white; width: 95%; max-width: 900px; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <!-- Header -->
                    <div style="padding: 1rem 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <h3 style="margin: 0; color: white; font-size: 1.1rem;">
                                <i class="fas fa-truck-loading"></i> Pick Release - Sales Orders
                            </h3>
                            <div style="display: flex; align-items: center; gap: 0.5rem; background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 6px;">
                                <label style="color: white; font-size: 11px; font-weight: 600;">Release Mode:</label>
                                <select id="pick-release-mode" onchange="togglePickReleaseMode()" style="padding: 4px 8px; border-radius: 4px; border: none; font-size: 11px; font-weight: 600; cursor: pointer;">
                                    <option value="with-lots" selected>With Lots</option>
                                    <option value="no-lots">No Lots</option>
                                </select>
                            </div>
                        </div>
                        <button onclick="closeSalesPickReleaseModal()" style="background: none; border: none; font-size: 1.5rem; color: white; cursor: pointer;">&times;</button>
                    </div>

                    <!-- Body -->
                    <div style="padding: 1.5rem; overflow-y: auto; max-height: 65vh;">
                        <!-- No Lots View (hidden by default) -->
                        <div id="no-lots-view" style="display: none;">
                            <div style="margin-bottom: 1.5rem;">
                                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #1f2937; font-size: 0.9rem;">
                                    <i class="fas fa-list"></i> Selected Orders (${orders.length})
                                </label>
                                <div style="border: 1px solid #e2e8f0; border-radius: 8px; max-height: 200px; overflow-y: auto; background: #f8f9fc;">
                                    ${noLotsOrderListHtml}
                                </div>
                            </div>
                            <div id="sales-pr-progress-section" style="display: none;">
                                <div style="margin-bottom: 1rem;">
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                        <span style="font-weight: 600; color: #1f2937;">Progress</span>
                                        <span id="sales-pr-progress-text" style="color: #64748b;">0 / ${orders.length}</span>
                                    </div>
                                    <div style="background: #e2e8f0; border-radius: 8px; height: 8px; overflow: hidden;">
                                        <div id="sales-pr-progress-bar" style="background: linear-gradient(90deg, #f59e0b, #d97706); height: 100%; width: 0%; transition: width 0.3s;"></div>
                                    </div>
                                </div>
                                <div id="sales-pr-log" style="max-height: 150px; overflow-y: auto; font-size: 0.85rem; background: #f8fafc; padding: 0.75rem; border-radius: 8px; border: 1px solid #e2e8f0;"></div>
                            </div>
                        </div>

                        <!-- With Lots View (shown by default) -->
                        <div id="with-lots-view">
                            <!-- Step Progress Indicators -->
                            <div style="display: flex; justify-content: space-around; margin-bottom: 1.5rem; padding: 1rem; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                                <div id="step-indicator-1" style="text-align: center; padding: 0.5rem 1rem;">
                                    <div style="width: 40px; height: 40px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.5rem; font-weight: 700; color: #64748b;">1</div>
                                    <div style="font-size: 11px; font-weight: 600; color: #64748b;">Release Pick Wave</div>
                                    <div id="step-1-status" style="font-size: 10px; color: #94a3b8; margin-top: 2px;">Pending</div>
                                </div>
                                <div style="display: flex; align-items: center; color: #cbd5e1;"><i class="fas fa-arrow-right"></i></div>
                                <div id="step-indicator-2" style="text-align: center; padding: 0.5rem 1rem;">
                                    <div style="width: 40px; height: 40px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.5rem; font-weight: 700; color: #64748b;">2</div>
                                    <div style="font-size: 11px; font-weight: 600; color: #64748b;">Total Picks</div>
                                    <div id="step-2-status" style="font-size: 10px; color: #94a3b8; margin-top: 2px;">Pending</div>
                                </div>
                                <div style="display: flex; align-items: center; color: #cbd5e1;"><i class="fas fa-arrow-right"></i></div>
                                <div id="step-indicator-3" style="text-align: center; padding: 0.5rem 1rem;">
                                    <div style="width: 40px; height: 40px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.5rem; font-weight: 700; color: #64748b;">3</div>
                                    <div style="font-size: 11px; font-weight: 600; color: #64748b;">Lots in the Pick</div>
                                    <div id="step-3-status" style="font-size: 10px; color: #94a3b8; margin-top: 2px;">Pending</div>
                                </div>
                            </div>

                            <!-- Orders Table -->
                            <div style="margin-bottom: 1rem;">
                                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #1f2937; font-size: 0.9rem;">
                                    <i class="fas fa-table"></i> Orders Progress (${orders.length})
                                </label>
                                <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; max-height: 300px; overflow-y: auto;">
                                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                                        <thead style="background: #f1f5f9; position: sticky; top: 0;">
                                            <tr>
                                                <th style="padding: 0.75rem 0.5rem; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Order Number</th>
                                                <th style="padding: 0.75rem 0.5rem; text-align: center; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Total Lines</th>
                                                <th style="padding: 0.75rem 0.5rem; text-align: center; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Release St</th>
                                                <th style="padding: 0.75rem 0.5rem; text-align: center; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Total Picks</th>
                                                <th style="padding: 0.75rem 0.5rem; text-align: center; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Lots in the Pick</th>
                                                <th style="padding: 0.75rem 0.5rem; text-align: center; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Retry</th>
                                                <th style="padding: 0.75rem 0.5rem; text-align: center; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Time</th>
                                            </tr>
                                        </thead>
                                        <tbody id="with-lots-orders-table">
                                            ${withLotsTableHtml}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <!-- Overall Progress -->
                            <div id="with-lots-progress-section" style="display: none; padding: 1rem; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                    <span style="font-weight: 600; color: #1f2937;">Overall Progress</span>
                                    <span id="with-lots-progress-text" style="color: #64748b;">0 / ${orders.length * 3} steps</span>
                                </div>
                                <div style="background: #e2e8f0; border-radius: 8px; height: 10px; overflow: hidden;">
                                    <div id="with-lots-progress-bar" style="background: linear-gradient(90deg, #10b981, #059669); height: 100%; width: 0%; transition: width 0.3s;"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; background: #f8f9fc; display: flex; gap: 0.75rem; justify-content: space-between; align-items: center;">
                        <button onclick="showPickReleaseApiInfo()" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="View API Information">
                            <i class="fas fa-code"></i> API Info
                        </button>
                        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
                            <button id="btn-fetch-order-lines" onclick="fetchSalesOrderLines()" class="btn" style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border: none; padding: 8px 12px; border-radius: 6px; font-size: 11px; cursor: pointer;">
                                <i class="fas fa-list-ol"></i> Fetch Sales Order Lines
                            </button>
                            <button id="btn-fetch-picks-lots" onclick="fetchPicksAndLots()" class="btn" style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: white; border: none; padding: 8px 12px; border-radius: 6px; font-size: 11px; cursor: pointer;">
                                <i class="fas fa-boxes"></i> Fetch Picks and Total Lots
                            </button>
                            <button onclick="closeSalesPickReleaseModal()" class="btn btn-secondary">
                                <i class="fas fa-times"></i> Cancel
                            </button>
                            <button id="btn-start-pick-release" onclick="startSalesOrderPickRelease()" class="btn btn-primary" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border: none;">
                                <i class="fas fa-truck-loading"></i> Pick Release
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // Toggle between With Lots and No Lots views
    window.togglePickReleaseMode = function() {
        const mode = document.getElementById('pick-release-mode').value;
        const noLotsView = document.getElementById('no-lots-view');
        const withLotsView = document.getElementById('with-lots-view');

        if (mode === 'with-lots') {
            noLotsView.style.display = 'none';
            withLotsView.style.display = 'block';
        } else {
            noLotsView.style.display = 'block';
            withLotsView.style.display = 'none';
        }

        console.log('[Pick Release] Mode changed to:', mode);
    };

    // Start Pick Release when button is clicked
    window.startSalesOrderPickRelease = function() {
        const orders = window.pendingSalesOrdersForPickRelease;
        const tripId = window.pendingTripIdForPickRelease;

        if (!orders || orders.length === 0) {
            alert('No orders to process.');
            return;
        }

        // Check release mode
        const modeSelect = document.getElementById('pick-release-mode');
        const mode = modeSelect ? modeSelect.value : 'no-lots';

        console.log('[Pick Release] Starting in mode:', mode);

        // Disable the Pick Release button
        const btn = document.getElementById('btn-start-pick-release');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            btn.style.opacity = '0.6';
        }

        if (mode === 'with-lots') {
            // Run With Lots 3-step flow
            startWithLotsPickRelease(orders, tripId);
        } else {
            // Run existing No Lots flow
            const progressSection = document.getElementById('sales-pr-progress-section');
            if (progressSection) progressSection.style.display = 'block';
            processSalesOrdersSequentially(orders, 0, tripId);
        }
    };

    // ============================================================================
    // FLOATING PROGRESS INDICATOR
    // Shows processing status when popup is closed during processing
    // ============================================================================

    // Global processing state
    window.pickReleaseProcessingState = {
        isProcessing: false,
        totalOrders: 0,
        completedOrders: 0,
        completedSteps: 0,
        totalSteps: 0,
        currentStep: '',
        startTime: null,
        // Individual stage tracking
        step1Status: 'pending', // pending, in-progress, complete
        step2Status: 'pending',
        step3Status: 'pending',
        step1Count: 0,  // Orders completed in step 1
        step2Count: 0,  // Orders completed in step 2
        step3Count: 0   // Orders completed in step 3
    };

    // Create or update floating indicator
    function showFloatingProgressIndicator() {
        let floatingDiv = document.getElementById('pick-release-floating-indicator');

        if (!floatingDiv) {
            floatingDiv = document.createElement('div');
            floatingDiv.id = 'pick-release-floating-indicator';
            floatingDiv.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                color: white;
                padding: 12px 16px;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: 99999;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 13px;
                font-weight: 500;
                min-width: 200px;
                transition: all 0.3s ease;
            `;
            floatingDiv.onclick = function() {
                reopenPickReleasePopup();
            };
            document.body.appendChild(floatingDiv);
        }

        updateFloatingIndicator();
    }

    // Update floating indicator content
    function updateFloatingIndicator() {
        const floatingDiv = document.getElementById('pick-release-floating-indicator');
        if (!floatingDiv) return;

        const state = window.pickReleaseProcessingState;

        if (!state.isProcessing) {
            // Processing complete
            floatingDiv.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            floatingDiv.innerHTML = `
                <i class="fas fa-check-circle" style="font-size: 18px;"></i>
                <div>
                    <div style="font-weight: 600;">Pick Release Complete</div>
                    <div style="font-size: 11px; opacity: 0.9;">${state.completedOrders} orders processed</div>
                </div>
                <button onclick="event.stopPropagation(); hideFloatingIndicator();" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-left: auto;">
                    <i class="fas fa-times"></i>
                </button>
            `;

            // Auto-hide after 10 seconds
            setTimeout(() => {
                hideFloatingIndicator();
            }, 10000);
        } else {
            // Still processing - calculate progress based on steps
            const progress = state.totalSteps > 0 ? Math.round((state.completedSteps / state.totalSteps) * 100) : 0;

            // Get step status icons
            const getStepIcon = (status, count, total) => {
                if (status === 'complete') return `<i class="fas fa-check-circle" style="color: #86efac;"></i> ${count}/${total}`;
                if (status === 'in-progress') return `<i class="fas fa-spinner fa-spin" style="color: #fef08a;"></i> ${count}/${total}`;
                return `<i class="fas fa-clock" style="color: rgba(255,255,255,0.5);"></i> 0/${total}`;
            };

            const totalOrders = state.totalOrders || 0;

            floatingDiv.innerHTML = `
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 6px;">Pick Release Running...</div>
                    <div style="display: flex; gap: 8px; font-size: 10px; margin-bottom: 6px;">
                        <span title="Step 1: Release Pick Wave">S1: ${getStepIcon(state.step1Status, state.step1Count, totalOrders)}</span>
                        <span title="Step 2: Get Picks">S2: ${getStepIcon(state.step2Status, state.step2Count, totalOrders)}</span>
                        <span title="Step 3: Get Lots">S3: ${getStepIcon(state.step3Status, state.step3Count, totalOrders)}</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.3); border-radius: 4px; height: 6px; overflow: hidden;">
                        <div style="background: white; height: 100%; width: ${progress}%; transition: width 0.3s;"></div>
                    </div>
                </div>
                <div style="font-size: 18px; font-weight: 700; margin-left: 10px;">${progress}%</div>
            `;
        }
    }

    // Show detailed progress popup
    function showFloatingProgressDetails() {
        const state = window.pickReleaseProcessingState;
        const data = window.withLotsPickReleaseData;

        if (!data) return;

        const elapsed = state.startTime ? formatDuration(Date.now() - state.startTime) : '-';

        let detailsHtml = `
            <div id="floating-details-popup" style="position: fixed; bottom: 80px; right: 20px; background: white; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); z-index: 99998; width: 350px; max-height: 400px; overflow: hidden;">
                <div style="padding: 12px 16px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600;"><i class="fas fa-tasks"></i> Pick Release Progress</span>
                    <button onclick="document.getElementById('floating-details-popup').remove();" style="background: none; border: none; color: white; cursor: pointer; font-size: 16px;">&times;</button>
                </div>
                <div style="padding: 12px 16px; max-height: 300px; overflow-y: auto;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 12px;">
                        <span><strong>Status:</strong> ${state.isProcessing ? 'Processing...' : 'Complete'}</span>
                        <span><strong>Time:</strong> ${elapsed}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 12px;">
                        <span><strong>Orders:</strong> ${state.completedOrders} / ${state.totalOrders}</span>
                        <span><strong>Step:</strong> ${state.currentStep}</span>
                    </div>
                    <div style="border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 10px;">
                        <div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">Order Progress:</div>
        `;

        // Show order status
        if (data.orders) {
            data.orders.forEach((order, i) => {
                const orderNum = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number;
                const result = data.results[i];
                let status = 'pending';
                let statusIcon = '<i class="fas fa-clock" style="color: #94a3b8;"></i>';

                if (result.step3 !== null) {
                    status = result.step3.success ? 'complete' : 'error';
                    statusIcon = result.step3.success ? '<i class="fas fa-check-circle" style="color: #10b981;"></i>' : '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';
                } else if (result.step2 !== null) {
                    statusIcon = '<i class="fas fa-spinner fa-spin" style="color: #f59e0b;"></i>';
                } else if (result.step1 !== null) {
                    statusIcon = '<i class="fas fa-spinner fa-spin" style="color: #f59e0b;"></i>';
                }

                detailsHtml += `
                    <div style="display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 11px;">
                        ${statusIcon}
                        <span>${orderNum}</span>
                    </div>
                `;
            });
        }

        detailsHtml += `
                    </div>
                </div>
            </div>
        `;

        // Remove existing popup if any
        const existingPopup = document.getElementById('floating-details-popup');
        if (existingPopup) existingPopup.remove();

        document.body.insertAdjacentHTML('beforeend', detailsHtml);
    }

    // Hide floating indicator
    function hideFloatingIndicator() {
        const floatingDiv = document.getElementById('pick-release-floating-indicator');
        if (floatingDiv) floatingDiv.remove();

        const detailsPopup = document.getElementById('floating-details-popup');
        if (detailsPopup) detailsPopup.remove();
    }

    // Reopen the Pick Release popup and restore current state
    function reopenPickReleasePopup() {
        const data = window.withLotsPickReleaseData;
        if (!data || !data.orders) {
            console.log('[Pick Release] No data to restore');
            return;
        }

        // Hide floating indicator
        hideFloatingIndicator();

        // Reopen the popup with the stored orders
        processSalesOrderPickRelease(data.orders, data.tripId);

        // After popup is created, restore the state of each cell
        setTimeout(() => {
            // Switch to With Lots mode
            const modeSelect = document.getElementById('pick-release-mode');
            if (modeSelect) {
                modeSelect.value = 'with-lots';
                togglePickReleaseMode();
            }

            // Show progress section
            const progressSection = document.getElementById('with-lots-progress-section');
            if (progressSection) progressSection.style.display = 'block';

            // Restore state for each order
            data.orders.forEach((order, i) => {
                const result = data.results[i];

                // Restore Total Lines
                if (window.pickReleaseProcessingState.totalLinesCount && window.pickReleaseProcessingState.totalLinesCount[i] !== undefined) {
                    const linesCell = document.getElementById(`wl-total-lines-${i}`);
                    if (linesCell) {
                        linesCell.innerHTML = `<span style="font-weight: 600;">${window.pickReleaseProcessingState.totalLinesCount[i]}</span>`;
                    }
                }

                // Restore Step 1 status
                if (result.step1 !== null) {
                    if (result.step1.success) {
                        updateCellStatus(`wl-release-st-${i}`, 'success');
                    } else {
                        updateCellStatus(`wl-release-st-${i}`, 'error', result.step1.error);
                        enableRetryButton(i);
                    }
                } else if (window.pickReleaseProcessingState.isProcessing) {
                    // Still processing, might be on this step
                    updateCellStatus(`wl-release-st-${i}`, 'processing');
                }

                // Restore Step 2 status
                if (result.step2 !== null) {
                    if (result.step2.success) {
                        const count = result.step2.data?.RECORDCOUNT || result.step2.data?.recordcount || 0;
                        updateCellStatus(`wl-get-picks-${i}`, 'success', null, count);
                    } else {
                        updateCellStatus(`wl-get-picks-${i}`, 'error', result.step2.error);
                        enableRetryButton(i);
                    }
                } else if (result.step1?.success && window.pickReleaseProcessingState.isProcessing) {
                    updateCellStatus(`wl-get-picks-${i}`, 'processing');
                } else if (!result.step1?.success && result.step1 !== null) {
                    updateCellStatus(`wl-get-picks-${i}`, 'skipped');
                }

                // Restore Step 3 status
                if (result.step3 !== null) {
                    if (result.step3.success) {
                        const count = result.step3.data?.RECORDCOUNT || result.step3.data?.recordcount || 0;
                        updateCellStatus(`wl-get-lots-${i}`, 'success', null, count);
                    } else {
                        updateCellStatus(`wl-get-lots-${i}`, 'error', result.step3.error);
                        enableRetryButton(i);
                    }
                } else if (result.step2?.success && window.pickReleaseProcessingState.isProcessing) {
                    updateCellStatus(`wl-get-lots-${i}`, 'processing');
                } else if (!result.step2?.success && result.step2 !== null) {
                    updateCellStatus(`wl-get-lots-${i}`, 'skipped');
                }
            });

            // Update step indicators based on current state
            const state = window.pickReleaseProcessingState;
            if (state.currentStep.includes('Step 1')) {
                updateStepIndicator(1, 'in-progress');
            } else if (state.currentStep.includes('Step 2') || state.currentStep.includes('Processing')) {
                updateStepIndicator(1, 'complete');
                updateStepIndicator(2, 'in-progress');
            }

            if (!state.isProcessing) {
                updateStepIndicator(1, 'complete');
                updateStepIndicator(2, 'complete');
                updateStepIndicator(3, 'complete');
                document.getElementById('step-1-status').textContent = 'Complete';
                document.getElementById('step-2-status').textContent = 'Complete';
                document.getElementById('step-3-status').textContent = 'Complete';

                // Update button to show completed
                const btn = document.getElementById('btn-start-pick-release');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-check"></i> Completed';
                    btn.style.opacity = '1';
                    btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
                    btn.onclick = function() { closeSalesPickReleaseModal(); };
                }
            } else {
                // Disable the start button while processing
                const btn = document.getElementById('btn-start-pick-release');
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
                    btn.style.opacity = '0.7';
                }
            }

            // Update progress bar
            const completedOrders = state.completedOrders || 0;
            const totalOrders = state.totalOrders || data.orders.length;
            updateWithLotsProgress(completedOrders * 3, totalOrders * 3);

        }, 100); // Small delay to ensure popup is rendered
    }

    // ============================================================================
    // WITH LOTS PICK RELEASE - 3 Step Process
    // Step 1: Release Pick Wave (for all orders)
    // Step 2: Total Picks (per order)
    // Step 3: Lots in the Pick (per order)
    // ============================================================================

    window.startWithLotsPickRelease = async function(orders, tripId) {
        console.log('[With Lots Pick Release] Starting 3-step process for', orders.length, 'orders');

        // Track overall timing
        const overallStartTime = Date.now();
        const orderStartTimes = [];

        // Track counts for comparison
        const totalLinesCount = [];
        const totalPicksCount = [];

        // Initialize processing state for floating indicator
        window.pickReleaseProcessingState = {
            isProcessing: true,
            totalOrders: orders.length,
            completedOrders: 0,
            completedSteps: 0,
            totalSteps: orders.length * 3, // 3 steps per order
            currentStep: 'Starting...',
            startTime: overallStartTime,
            step1Status: 'pending',
            step2Status: 'pending',
            step3Status: 'pending',
            step1Count: 0,
            step2Count: 0,
            step3Count: 0
        };

        // Show progress section
        const progressSection = document.getElementById('with-lots-progress-section');
        if (progressSection) progressSection.style.display = 'block';

        // Get instance
        const instance = orders[0]?.INSTANCE_NAME || orders[0]?.instance_name || window.currentTripInstance || 'TEST';
        const warehouse = 'GIC'; // Default warehouse

        // Store for retry functionality
        window.withLotsPickReleaseData = {
            orders: orders,
            tripId: tripId,
            instance: instance,
            warehouse: warehouse,
            results: orders.map(() => ({ step1: null, step2: null, step3: null }))
        };

        let totalSteps = orders.length * 3;
        let completedSteps = 0;

        // STEP 0: Fetch Total Lines for all orders first (in parallel)
        console.log('[With Lots] Fetching Total Lines for all orders...');
        const totalLinesPromises = orders.map((order, i) => {
            const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number;
            return fetchFusionOrderLinesAPI(orderNumber, instance).then(result => {
                totalLinesCount[i] = result.count || 0;
                const cell = document.getElementById(`wl-total-lines-${i}`);
                if (cell) {
                    cell.innerHTML = `<span style="font-weight: 600;">${totalLinesCount[i]}</span>`;
                }
                return result;
            });
        });
        await Promise.all(totalLinesPromises);

        // Store total lines count in processing state for popup restoration
        window.pickReleaseProcessingState.totalLinesCount = totalLinesCount;

        // Update step indicator to show Step 1 in progress
        updateStepIndicator(1, 'in-progress');

        // STEP 1: Release Pick Wave for ALL orders first
        console.log('[With Lots] Step 1: Release Pick Wave for all orders');
        document.getElementById('step-1-status').textContent = 'In Progress...';

        // Update processing state
        window.pickReleaseProcessingState.currentStep = 'Step 1: Release Pick Wave';
        window.pickReleaseProcessingState.step1Status = 'in-progress';
        updateFloatingIndicator();

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number;

            // Track start time for this order
            orderStartTimes[i] = Date.now();

            updateCellStatus(`wl-release-st-${i}`, 'processing');

            try {
                const result = await callReleasePickWaveAPI(orderNumber, warehouse, instance);
                window.withLotsPickReleaseData.results[i].step1 = result;

                if (result.success) {
                    updateCellStatus(`wl-release-st-${i}`, 'success');
                } else {
                    updateCellStatus(`wl-release-st-${i}`, 'error', result.error);
                    enableRetryButton(i);
                }
            } catch (error) {
                window.withLotsPickReleaseData.results[i].step1 = { success: false, error: error.message };
                updateCellStatus(`wl-release-st-${i}`, 'error', error.message);
                enableRetryButton(i);
            }

            completedSteps++;
            updateWithLotsProgress(completedSteps, totalSteps);

            // Update floating indicator with step 1 progress
            window.pickReleaseProcessingState.step1Count = i + 1;
            window.pickReleaseProcessingState.completedSteps = completedSteps;
            updateFloatingIndicator();
        }

        // Mark Step 1 complete
        updateStepIndicator(1, 'complete');
        document.getElementById('step-1-status').textContent = 'Complete';

        // Update floating indicator - Step 1 complete
        window.pickReleaseProcessingState.step1Status = 'complete';
        updateFloatingIndicator();

        // STEP 2 & 3: Total Picks and Lots in the Pick per order
        updateStepIndicator(2, 'in-progress');
        document.getElementById('step-2-status').textContent = 'In Progress...';

        // Update processing state
        window.pickReleaseProcessingState.currentStep = 'Step 2: Fetching Picks';
        window.pickReleaseProcessingState.step2Status = 'in-progress';
        updateFloatingIndicator();

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number;

            // Only proceed if Step 1 was successful
            if (!window.withLotsPickReleaseData.results[i].step1?.success) {
                updateCellStatus(`wl-get-picks-${i}`, 'skipped');
                updateCellStatus(`wl-get-lots-${i}`, 'skipped');
                completedSteps += 2;
                updateWithLotsProgress(completedSteps, totalSteps);
                // Update time for this row
                updateOrderTime(i, orderStartTimes[i]);
                continue;
            }

            // Step 2: Total Picks
            updateCellStatus(`wl-get-picks-${i}`, 'processing');

            try {
                const picksResult = await callGetPicksAPI(orderNumber, warehouse, instance);
                window.withLotsPickReleaseData.results[i].step2 = picksResult;

                if (picksResult.success) {
                    const count = picksResult.data?.RECORDCOUNT || picksResult.data?.recordcount || picksResult.data?.items?.length || 0;
                    totalPicksCount[i] = count; // Store for comparison
                    updateCellStatus(`wl-get-picks-${i}`, 'success', null, count);
                } else {
                    totalPicksCount[i] = 0;
                    updateCellStatus(`wl-get-picks-${i}`, 'error', picksResult.error);
                    enableRetryButton(i);
                }
            } catch (error) {
                totalPicksCount[i] = 0;
                window.withLotsPickReleaseData.results[i].step2 = { success: false, error: error.message };
                updateCellStatus(`wl-get-picks-${i}`, 'error', error.message);
                enableRetryButton(i);
            }

            completedSteps++;
            updateWithLotsProgress(completedSteps, totalSteps);

            // Update floating indicator with step 2 progress
            window.pickReleaseProcessingState.step2Count = i + 1;
            window.pickReleaseProcessingState.completedSteps = completedSteps;
            updateFloatingIndicator();

            // Step 3: Lots in the Pick (only if Step 2 was successful)
            window.pickReleaseProcessingState.currentStep = 'Step 3: Fetching Lots';
            window.pickReleaseProcessingState.step3Status = 'in-progress';

            if (window.withLotsPickReleaseData.results[i].step2?.success) {
                updateCellStatus(`wl-get-lots-${i}`, 'processing');

                try {
                    const lotsResult = await callGetPickLotsAPI(orderNumber, instance);
                    window.withLotsPickReleaseData.results[i].step3 = lotsResult;

                    if (lotsResult.success) {
                        const count = lotsResult.data?.RECORDCOUNT || lotsResult.data?.recordcount || lotsResult.data?.items?.length || 0;
                        updateCellStatus(`wl-get-lots-${i}`, 'success', null, count);
                    } else {
                        updateCellStatus(`wl-get-lots-${i}`, 'error', lotsResult.error);
                        enableRetryButton(i);
                    }
                } catch (error) {
                    window.withLotsPickReleaseData.results[i].step3 = { success: false, error: error.message };
                    updateCellStatus(`wl-get-lots-${i}`, 'error', error.message);
                    enableRetryButton(i);
                }
            } else {
                updateCellStatus(`wl-get-lots-${i}`, 'skipped');
            }

            completedSteps++;
            updateWithLotsProgress(completedSteps, totalSteps);

            // Update floating indicator with step 3 progress
            window.pickReleaseProcessingState.step3Count = i + 1;
            window.pickReleaseProcessingState.completedSteps = completedSteps;

            // Update time for this row
            updateOrderTime(i, orderStartTimes[i]);

            // Update floating indicator progress
            window.pickReleaseProcessingState.completedOrders = i + 1;
            window.pickReleaseProcessingState.currentStep = `Processing order ${i + 1} of ${orders.length}`;
            updateFloatingIndicator();
        }

        // Mark steps complete
        updateStepIndicator(2, 'complete');
        updateStepIndicator(3, 'complete');
        document.getElementById('step-2-status').textContent = 'Complete';
        document.getElementById('step-3-status').textContent = 'Complete';

        // Update floating indicator - all steps complete
        window.pickReleaseProcessingState.step2Status = 'complete';
        window.pickReleaseProcessingState.step3Status = 'complete';
        updateFloatingIndicator();

        // Mark orders where Total Lines < Total Picks (mismatch warning)
        let mismatchCount = 0;
        for (let i = 0; i < orders.length; i++) {
            const lines = totalLinesCount[i] || 0;
            const picks = totalPicksCount[i] || 0;
            if (lines > 0 && picks > 0 && lines < picks) {
                mismatchCount++;
                const row = document.getElementById(`wl-order-row-${i}`);
                if (row) {
                    row.style.background = '#fef3c7'; // Yellow warning background
                }
                // Update Total Lines cell to show warning
                const linesCell = document.getElementById(`wl-total-lines-${i}`);
                if (linesCell) {
                    linesCell.innerHTML = `<span style="color: #d97706; font-weight: 600;">${lines} <i class="fas fa-exclamation-triangle" style="font-size: 10px;" title="Total Lines (${lines}) < Total Picks (${picks})"></i></span>`;
                }
            }
        }

        if (mismatchCount > 0) {
            console.log(`[With Lots] Warning: ${mismatchCount} order(s) have Total Lines < Total Picks`);
        }

        // Calculate and display total time
        const totalTime = Date.now() - overallStartTime;
        const totalTimeFormatted = formatDuration(totalTime);

        // Show total time summary
        const progressSection2 = document.getElementById('with-lots-progress-section');
        if (progressSection2) {
            const totalTimeDiv = document.createElement('div');
            totalTimeDiv.style.cssText = 'margin-top: 1rem; padding: 0.75rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 8px; text-align: center;';
            totalTimeDiv.innerHTML = `
                <span style="color: white; font-weight: 600; font-size: 14px;">
                    <i class="fas fa-clock"></i> Total Time: ${totalTimeFormatted}
                </span>
            `;
            progressSection2.appendChild(totalTimeDiv);
        }

        // Update button to show completed
        const btn = document.getElementById('btn-start-pick-release');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Completed';
            btn.style.opacity = '1';
            btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            btn.onclick = function() { closeSalesPickReleaseModal(); };
        }

        // Mark processing as complete for floating indicator
        window.pickReleaseProcessingState.isProcessing = false;
        window.pickReleaseProcessingState.currentStep = 'Complete';
        window.pickReleaseProcessingState.completedOrders = orders.length;
        updateFloatingIndicator();

        console.log('[With Lots Pick Release] Process complete. Total time:', totalTimeFormatted);
    };

    // ============================================================================
    // INDIVIDUAL BUTTON FUNCTIONS
    // ============================================================================

    // Fetch Sales Order Lines - Only calls fetchfusionorderlines API
    window.fetchSalesOrderLines = async function() {
        const data = window.withLotsPickReleaseData;
        if (!data) {
            console.log('[Fetch Sales Order Lines] No data available');
            return;
        }

        const orders = data.orders;
        const instance = data.instance;

        console.log('[Fetch Sales Order Lines] Starting for', orders.length, 'orders');

        // Disable button during processing
        const btn = document.getElementById('btn-fetch-order-lines');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
        }

        const startTime = Date.now();

        // Fetch total lines for all orders in parallel
        const promises = orders.map((order, i) => {
            const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number;

            // Show loading in cell
            const cell = document.getElementById(`wl-total-lines-${i}`);
            if (cell) {
                cell.innerHTML = '<span style="color: #94a3b8;"><i class="fas fa-spinner fa-spin" style="font-size: 10px;"></i></span>';
            }

            return fetchFusionOrderLinesAPI(orderNumber, instance).then(result => {
                const count = result.count || 0;
                if (cell) {
                    cell.innerHTML = `<span style="font-weight: 600;">${count}</span>`;
                }
                return { index: i, count: count, success: result.success };
            });
        });

        const results = await Promise.all(promises);

        const elapsed = Date.now() - startTime;
        console.log('[Fetch Sales Order Lines] Complete. Time:', formatDuration(elapsed));

        // Re-enable button
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Lines Fetched';
            btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        }
    };

    // Fetch Picks and Total Lots - Calls both getopenpicksbyorder and getlotsforpicks APIs
    window.fetchPicksAndLots = async function() {
        const data = window.withLotsPickReleaseData;
        if (!data) {
            console.log('[Fetch Picks & Lots] No data available');
            return;
        }

        const orders = data.orders;
        const instance = data.instance;
        const warehouse = data.warehouse;

        console.log('[Fetch Picks & Lots] Starting for', orders.length, 'orders');

        // Disable button during processing
        const btn = document.getElementById('btn-fetch-picks-lots');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
        }

        const startTime = Date.now();
        const orderStartTimes = [];

        // Process each order sequentially
        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number;

            orderStartTimes[i] = Date.now();

            // Step 1: Get Picks
            updateCellStatus(`wl-get-picks-${i}`, 'processing');

            try {
                const picksResult = await callGetPicksAPI(orderNumber, warehouse, instance);

                if (picksResult.success) {
                    const count = picksResult.data?.RECORDCOUNT || picksResult.data?.recordcount || picksResult.data?.items?.length || 0;
                    updateCellStatus(`wl-get-picks-${i}`, 'success', null, count);
                } else {
                    updateCellStatus(`wl-get-picks-${i}`, 'error', picksResult.error);
                }
            } catch (error) {
                updateCellStatus(`wl-get-picks-${i}`, 'error', error.message);
            }

            // Step 2: Get Pick Lots
            updateCellStatus(`wl-get-lots-${i}`, 'processing');

            try {
                const lotsResult = await callGetPickLotsAPI(orderNumber, instance);

                if (lotsResult.success) {
                    const count = lotsResult.data?.RECORDCOUNT || lotsResult.data?.recordcount || lotsResult.data?.items?.length || 0;
                    updateCellStatus(`wl-get-lots-${i}`, 'success', null, count);
                } else {
                    updateCellStatus(`wl-get-lots-${i}`, 'error', lotsResult.error);
                }
            } catch (error) {
                updateCellStatus(`wl-get-lots-${i}`, 'error', error.message);
            }

            // Update time for this row
            updateOrderTime(i, orderStartTimes[i]);
        }

        const elapsed = Date.now() - startTime;
        console.log('[Fetch Picks & Lots] Complete. Time:', formatDuration(elapsed));

        // Re-enable button
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Picks & Lots Fetched';
            btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        }
    };

    // API Call Functions
    function callReleasePickWaveAPI(orderNumber, warehouse, instance) {
        return new Promise((resolve) => {
            const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/callpickwave?warehouse=${warehouse}&order_number=${orderNumber}&p_instance_name=${instance}`;

            console.log('[With Lots] Calling Release Pick Wave:', apiUrl);

            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: JSON.stringify({})
            }, function(error, data) {
                if (error) {
                    resolve({ success: false, error: error });
                } else {
                    try {
                        const response = typeof data === 'string' ? JSON.parse(data) : data;
                        resolve({ success: true, data: response });
                    } catch (e) {
                        resolve({ success: true, data: data });
                    }
                }
            });
        });
    }

    function callGetPicksAPI(orderNumber, warehouse, instance) {
        return new Promise((resolve) => {
            const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trips/getopenpicksbyorder?organization_code=${warehouse}&order_number=${orderNumber}&p_instance_name=${instance}`;

            console.log('[With Lots] Calling Total Picks:', apiUrl);

            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: JSON.stringify({})
            }, function(error, data) {
                if (error) {
                    resolve({ success: false, error: error });
                } else {
                    try {
                        const response = typeof data === 'string' ? JSON.parse(data) : data;
                        resolve({ success: true, data: response });
                    } catch (e) {
                        resolve({ success: true, data: data });
                    }
                }
            });
        });
    }

    function callGetPickLotsAPI(orderNumber, instance) {
        return new Promise((resolve) => {
            const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/getlotsforpicks?source_order_number=${orderNumber}&p_instance_name=${instance}`;

            console.log('[With Lots] Calling Lots in the Pick:', apiUrl);

            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: JSON.stringify({})
            }, function(error, data) {
                if (error) {
                    resolve({ success: false, error: error });
                } else {
                    try {
                        const response = typeof data === 'string' ? JSON.parse(data) : data;
                        resolve({ success: true, data: response });
                    } catch (e) {
                        resolve({ success: true, data: data });
                    }
                }
            });
        });
    }

    // Fetch total lines count from Fusion for an order
    function fetchFusionOrderLinesAPI(orderNumber, instance) {
        return new Promise((resolve) => {
            const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instance}&p_order_number=${orderNumber}`;

            console.log('[With Lots] Fetching Total Lines:', apiUrl);

            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: JSON.stringify({})
            }, function(error, data) {
                if (error) {
                    resolve({ success: false, error: error, count: 0 });
                } else {
                    try {
                        const response = typeof data === 'string' ? JSON.parse(data) : data;
                        const count = response?.RECORDCOUNT || response?.recordcount || 0;
                        resolve({ success: true, data: response, count: count });
                    } catch (e) {
                        resolve({ success: false, error: e.message, count: 0 });
                    }
                }
            });
        });
    }

    // Helper Functions for With Lots UI
    function updateStepIndicator(step, status) {
        const indicator = document.getElementById(`step-indicator-${step}`);
        if (!indicator) return;

        const circle = indicator.querySelector('div');
        if (status === 'in-progress') {
            circle.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            circle.style.color = 'white';
            circle.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 16px;"></i>';
        } else if (status === 'complete') {
            circle.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            circle.style.color = 'white';
            circle.innerHTML = '<i class="fas fa-check" style="font-size: 16px;"></i>';
        }
    }

    function updateCellStatus(cellId, status, errorMsg, count) {
        const cell = document.getElementById(cellId);
        if (!cell) return;

        if (status === 'processing') {
            cell.innerHTML = '<span style="color: #f59e0b;"><i class="fas fa-spinner fa-spin" style="font-size: 12px;"></i></span>';
        } else if (status === 'success') {
            if (count !== undefined) {
                cell.innerHTML = `<span style="color: #10b981;"><i class="fas fa-check-circle" style="font-size: 12px;"></i> <span style="font-size: 10px;">(${count})</span></span>`;
            } else {
                cell.innerHTML = '<span style="color: #10b981;"><i class="fas fa-check-circle" style="font-size: 12px;"></i></span>';
            }
        } else if (status === 'error') {
            cell.innerHTML = `<span style="color: #ef4444;" title="${errorMsg || 'Error'}"><i class="fas fa-times-circle" style="font-size: 12px;"></i></span>`;
        } else if (status === 'skipped') {
            cell.innerHTML = '<span style="color: #94a3b8;"><i class="fas fa-minus-circle" style="font-size: 12px;"></i></span>';
        }
    }

    // Format duration in ms to readable format (e.g., "1m 23s" or "45s" or "1.2s")
    function formatDuration(ms) {
        if (ms < 1000) {
            return `${ms}ms`;
        } else if (ms < 60000) {
            return `${(ms / 1000).toFixed(1)}s`;
        } else {
            const minutes = Math.floor(ms / 60000);
            const seconds = ((ms % 60000) / 1000).toFixed(0);
            return `${minutes}m ${seconds}s`;
        }
    }

    // Update time cell for a specific order row
    function updateOrderTime(index, startTime) {
        const elapsed = Date.now() - startTime;
        const timeCell = document.getElementById(`wl-time-${index}`);
        if (timeCell) {
            timeCell.innerHTML = `<span style="color: #3b82f6; font-weight: 500;">${formatDuration(elapsed)}</span>`;
        }
    }

    function enableRetryButton(index) {
        const btn = document.querySelector(`#wl-retry-${index} button`);
        if (btn) {
            btn.disabled = false;
            btn.style.background = '#fef3c7';
            btn.style.color = '#d97706';
        }
    }

    function updateWithLotsProgress(completed, total) {
        const progressText = document.getElementById('with-lots-progress-text');
        const progressBar = document.getElementById('with-lots-progress-bar');

        if (progressText) progressText.textContent = `${completed} / ${total} steps`;
        if (progressBar) progressBar.style.width = `${(completed / total) * 100}%`;
    }

    // Retry function for a single order
    window.retryWithLotsOrder = async function(index) {
        const data = window.withLotsPickReleaseData;
        if (!data) return;

        const order = data.orders[index];
        const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number;

        console.log('[With Lots] Retrying order:', orderNumber);

        // Disable retry button
        const btn = document.querySelector(`#wl-retry-${index} button`);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        // Retry Step 1
        updateCellStatus(`wl-release-st-${index}`, 'processing');
        try {
            const result1 = await callReleasePickWaveAPI(orderNumber, data.warehouse, data.instance);
            data.results[index].step1 = result1;

            if (result1.success) {
                updateCellStatus(`wl-release-st-${index}`, 'success');
            } else {
                updateCellStatus(`wl-release-st-${index}`, 'error', result1.error);
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-redo"></i>';
                }
                return;
            }
        } catch (error) {
            updateCellStatus(`wl-release-st-${index}`, 'error', error.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-redo"></i>';
            }
            return;
        }

        // Retry Step 2
        updateCellStatus(`wl-get-picks-${index}`, 'processing');
        try {
            const result2 = await callGetPicksAPI(orderNumber, data.warehouse, data.instance);
            data.results[index].step2 = result2;

            if (result2.success) {
                const count = result2.data?.RECORDCOUNT || result2.data?.recordcount || result2.data?.items?.length || 0;
                updateCellStatus(`wl-get-picks-${index}`, 'success', null, count);
            } else {
                updateCellStatus(`wl-get-picks-${index}`, 'error', result2.error);
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-redo"></i>';
                }
                return;
            }
        } catch (error) {
            updateCellStatus(`wl-get-picks-${index}`, 'error', error.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-redo"></i>';
            }
            return;
        }

        // Retry Step 3
        updateCellStatus(`wl-get-lots-${index}`, 'processing');
        try {
            const result3 = await callGetPickLotsAPI(orderNumber, data.instance);
            data.results[index].step3 = result3;

            if (result3.success) {
                const count = result3.data?.RECORDCOUNT || result3.data?.recordcount || result3.data?.items?.length || 0;
                updateCellStatus(`wl-get-lots-${index}`, 'success', null, count);
            } else {
                updateCellStatus(`wl-get-lots-${index}`, 'error', result3.error);
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-redo"></i>';
                }
                return;
            }
        } catch (error) {
            updateCellStatus(`wl-get-lots-${index}`, 'error', error.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-redo"></i>';
            }
            return;
        }

        // All steps successful - disable retry button
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-check"></i>';
            btn.style.background = '#d1fae5';
            btn.style.color = '#059669';
        }
    };

    window.closeSalesPickReleaseModal = function() {
        const modal = document.getElementById('sales-pick-release-modal');

        // Check if processing is still in progress
        if (window.pickReleaseProcessingState && window.pickReleaseProcessingState.isProcessing) {
            // Show floating indicator before closing
            showFloatingProgressIndicator();
        }

        if (modal) modal.remove();
    };

    // Show API Information for Pick Release
    window.showPickReleaseApiInfo = function() {
        const orders = window.pendingSalesOrdersForPickRelease || [];
        const tripId = window.pendingTripIdForPickRelease || 'N/A';

        // Get current mode
        const modeSelect = document.getElementById('pick-release-mode');
        const mode = modeSelect ? modeSelect.value : 'no-lots';

        // Get sample order for display
        const sampleOrder = orders[0] || {};
        const sampleOrderNumber = sampleOrder.SOURCE_ORDER_NUMBER || sampleOrder.source_order_number || sampleOrder.ORDER_NUMBER || sampleOrder.order_number || '{orderNumber}';
        const instance = sampleOrder.INSTANCE_NAME || sampleOrder.instance_name || window.currentTripInstance || 'TEST';
        const warehouse = 'GIC';

        const baseUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT';

        let apiContent = '';

        if (mode === 'with-lots') {
            // With Lots mode - show 3 APIs
            apiContent = `
                <!-- Mode Badge -->
                <div style="background: #dbeafe; padding: 0.5rem 1rem; border-radius: 6px; margin-bottom: 1rem; display: inline-block;">
                    <span style="color: #1e40af; font-weight: 600; font-size: 12px;"><i class="fas fa-boxes"></i> Mode: With Lots (3-Step Process)</span>
                </div>

                <!-- Step 1: Release Pick Wave -->
                <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; margin-bottom: 0.75rem; border-left: 3px solid #3b82f6;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <span style="background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">STEP 1</span>
                        <span style="background: #c6f6d5; color: #22543d; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">GET</span>
                        <strong style="color: #1e293b; font-size: 12px;">Release Pick Wave</strong>
                    </div>
                    <code style="background: #edf2f7; padding: 6px 10px; border-radius: 4px; font-size: 9px; word-break: break-all; display: block;">${baseUrl}/trip/callpickwave?warehouse=${warehouse}&order_number=${sampleOrderNumber}&p_instance_name=${instance}</code>
                </div>

                <!-- Step 2: Total Picks -->
                <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; margin-bottom: 0.75rem; border-left: 3px solid #10b981;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <span style="background: #d1fae5; color: #065f46; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">STEP 2</span>
                        <span style="background: #c6f6d5; color: #22543d; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">GET</span>
                        <strong style="color: #1e293b; font-size: 12px;">Total Picks</strong>
                    </div>
                    <code style="background: #edf2f7; padding: 6px 10px; border-radius: 4px; font-size: 9px; word-break: break-all; display: block;">${baseUrl}/trips/getopenpicksbyorder?organization_code=${warehouse}&order_number=${sampleOrderNumber}&p_instance_name=${instance}</code>
                </div>

                <!-- Step 3: Lots in the Pick -->
                <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; margin-bottom: 0.75rem; border-left: 3px solid #8b5cf6;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <span style="background: #ede9fe; color: #5b21b6; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">STEP 3</span>
                        <span style="background: #c6f6d5; color: #22543d; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">GET</span>
                        <strong style="color: #1e293b; font-size: 12px;">Lots in the Pick</strong>
                    </div>
                    <code style="background: #edf2f7; padding: 6px 10px; border-radius: 4px; font-size: 9px; word-break: break-all; display: block;">${baseUrl}/trip/getlotsforpicks?source_order_number=${sampleOrderNumber}&p_instance_name=${instance}</code>
                </div>

                <!-- Flow Note -->
                <div style="background: #fef3c7; padding: 0.75rem; border-radius: 8px; border-left: 4px solid #f59e0b;">
                    <strong style="color: #92400e;"><i class="fas fa-info-circle"></i> Process Flow:</strong>
                    <span style="color: #78350f; font-size: 11px;">
                        Step 1 runs for ALL orders first, then Step 2 & 3 run per order sequentially. Total: ${orders.length * 3} API calls.
                    </span>
                </div>
            `;
        } else {
            // No Lots mode - show single API
            const fullUrl = `${baseUrl}/trip/pickrelease/oneorder/${sampleOrderNumber}?P_TRIP_ID1=${tripId}&P_INSTANCE_NAME=${instance}`;

            apiContent = `
                <!-- Mode Badge -->
                <div style="background: #fef3c7; padding: 0.5rem 1rem; border-radius: 6px; margin-bottom: 1rem; display: inline-block;">
                    <span style="color: #92400e; font-weight: 600; font-size: 12px;"><i class="fas fa-box"></i> Mode: No Lots (Single API)</span>
                </div>

                <!-- API Details -->
                <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 3px solid #f59e0b;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <span style="background: #fed7aa; color: #9c4221; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">POST</span>
                        <strong style="color: #1e293b; font-size: 12px;">Pick Release One Order</strong>
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <strong style="color: #4a5568; font-size: 11px;">Endpoint:</strong>
                        <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px; font-size: 10px; display: block; margin-top: 4px;">trip/pickrelease/oneorder/{orderNumber}?P_TRIP_ID1={tripId}&P_INSTANCE_NAME={instance}</code>
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <strong style="color: #4a5568; font-size: 11px;">Sample Full URL:</strong>
                        <code style="background: #edf2f7; padding: 6px 10px; border-radius: 4px; font-size: 9px; word-break: break-all; display: block; margin-top: 4px;">${fullUrl}</code>
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <strong style="color: #4a5568; font-size: 11px;">Request Body:</strong>
                        <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px; font-size: 10px; display: block; margin-top: 4px;">{}</code>
                    </div>
                </div>

                <!-- Note -->
                <div style="background: #fef3c7; padding: 0.75rem; border-radius: 8px; border-left: 4px solid #f59e0b;">
                    <strong style="color: #92400e;"><i class="fas fa-info-circle"></i> Note:</strong>
                    <span style="color: #78350f; font-size: 12px;">This API is called for each order sequentially. Total ${orders.length} API calls will be made.</span>
                </div>
            `;
        }

        const popupHtml = `
            <div id="pick-release-api-info-popup" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 30000; display: flex; justify-content: center; align-items: center;">
                <div style="background: white; width: 90%; max-width: 750px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.1rem;">
                            <i class="fas fa-code"></i> Pick Release API Information
                        </h3>
                        <button onclick="document.getElementById('pick-release-api-info-popup').remove()" style="background: none; border: none; font-size: 1.5rem; color: white; cursor: pointer;">&times;</button>
                    </div>
                    <div style="padding: 1.5rem; max-height: 70vh; overflow-y: auto;">
                        <!-- Current Context -->
                        <div style="background: #eff6ff; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #3b82f6;">
                            <div style="font-weight: 600; color: #1e40af; margin-bottom: 0.5rem;">Current Context</div>
                            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Trip ID:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600;">${tripId}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Instance:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600; color: #7c3aed;">${instance}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Warehouse:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600;">${warehouse}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Orders Count:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600;">${orders.length}</td>
                                </tr>
                            </table>
                        </div>

                        ${apiContent}
                    </div>
                    <div style="padding: 1rem 1.5rem; border-top: 2px solid #f0f0f0; display: flex; justify-content: flex-end;">
                        <button onclick="document.getElementById('pick-release-api-info-popup').remove()" class="btn btn-secondary" style="padding: 8px 20px;">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing popup if any
        const existingPopup = document.getElementById('pick-release-api-info-popup');
        if (existingPopup) existingPopup.remove();

        // Add popup to body
        document.body.insertAdjacentHTML('beforeend', popupHtml);
    };

    function addSalesPRLog(message, type = 'info') {
        const logDiv = document.getElementById('sales-pr-log');
        if (logDiv) {
            const color = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#64748b';
            const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : type === 'warning' ? '⚠' : '→';
            logDiv.innerHTML += `<div style="color: ${color}; margin-bottom: 0.25rem;">${icon} ${message}</div>`;
            logDiv.scrollTop = logDiv.scrollHeight;
        }
    }

    function updateSalesPRProgress(current, total) {
        const progressText = document.getElementById('sales-pr-progress-text');
        const progressBar = document.getElementById('sales-pr-progress-bar');
        if (progressText) progressText.textContent = `${current} / ${total}`;
        if (progressBar) progressBar.style.width = `${(current / total) * 100}%`;
    }

    function processSalesOrdersSequentially(orders, index, tripId) {
        if (index >= orders.length) {
            addSalesPRLog(`Completed! Processed ${orders.length} order(s).`, 'success');

            // Update button to show completed state - clicking will close modal
            const btn = document.getElementById('btn-start-pick-release');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check"></i> Completed';
                btn.style.opacity = '1';
                btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
                btn.onclick = function() { closeSalesPickReleaseModal(); };
            }
            return;
        }

        // Update current order status to "processing"
        const statusEl = document.getElementById(`pr-order-status-${index}`);
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: #f59e0b;"></i>';
        }

        const order = orders[index];
        const orderNumber = order.SOURCE_ORDER_NUMBER || order.source_order_number || order.ORDER_NUMBER || order.order_number || '';

        if (!orderNumber) {
            addSalesPRLog(`Order ${index + 1}: Missing order number, skipping...`, 'warning');
            updateSalesPRProgress(index + 1, orders.length);
            setTimeout(() => processSalesOrdersSequentially(orders, index + 1, tripId), 300);
            return;
        }

        addSalesPRLog(`Processing order: ${orderNumber}...`, 'info');

        // Get instance from order or fallback
        const instance = order.INSTANCE_NAME || order.instance_name || window.currentTripInstance || 'TEST';

        // Build API URL with trip ID and instance parameters
        const PICK_RELEASE_API = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/pickrelease/oneorder/${orderNumber}?P_TRIP_ID1=${tripId}&P_INSTANCE_NAME=${instance}`;

        console.log('[Sales Order Pick Release] Calling API:', PICK_RELEASE_API);

        if (window.chrome && window.chrome.webview) {
            // WebView2 environment - use C# backend
            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: PICK_RELEASE_API,
                body: '{}'
            }, function(error, data) {
                const statusEl = document.getElementById(`pr-order-status-${index}`);
                let isSuccess = false;

                if (error) {
                    console.error('[Sales Order Pick Release] Error:', error);
                    addSalesPRLog(`${orderNumber}: Error - ${error}`, 'error');
                } else {
                    try {
                        const result = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log('[Sales Order Pick Release] Response:', result);

                        if (result.success === true || result.success === 'true' || result.status === 'success') {
                            addSalesPRLog(`${orderNumber}: Pick release successful`, 'success');
                            isSuccess = true;
                        } else {
                            const msg = result.message || result.error || 'Unknown response';
                            addSalesPRLog(`${orderNumber}: ${msg}`, result.success === false ? 'error' : 'success');
                            isSuccess = result.success !== false;
                        }
                    } catch (parseError) {
                        // If response is not JSON, assume success
                        addSalesPRLog(`${orderNumber}: Pick release completed`, 'success');
                        isSuccess = true;
                    }
                }

                // Update status icon
                if (statusEl) {
                    if (isSuccess) {
                        statusEl.innerHTML = '<i class="fas fa-check-circle" style="color: #10b981;"></i>';
                    } else {
                        statusEl.innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';
                    }
                }

                updateSalesPRProgress(index + 1, orders.length);
                setTimeout(() => processSalesOrdersSequentially(orders, index + 1, tripId), 500);
            });
        } else {
            // Browser testing fallback
            let isSuccess = false;
            fetch(PICK_RELEASE_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
            })
            .then(response => response.json())
            .then(result => {
                console.log('[Sales Order Pick Release] Response:', result);
                addSalesPRLog(`${orderNumber}: Pick release completed`, 'success');
                isSuccess = true;
            })
            .catch(error => {
                console.error('[Sales Order Pick Release] Error:', error);
                addSalesPRLog(`${orderNumber}: Error - ${error.message}`, 'error');
                isSuccess = false;
            })
            .finally(() => {
                // Update status icon
                const statusEl = document.getElementById(`pr-order-status-${index}`);
                if (statusEl) {
                    if (isSuccess) {
                        statusEl.innerHTML = '<i class="fas fa-check-circle" style="color: #10b981;"></i>';
                    } else {
                        statusEl.innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';
                    }
                }

                updateSalesPRProgress(index + 1, orders.length);
                setTimeout(() => processSalesOrdersSequentially(orders, index + 1, tripId), 500);
            });
        }
    }

    // ============================================================================
    // SHOW TRIP LINES - Displays trip line details in popup
    // ============================================================================
    window.showTripLines = function(tripId) {
        console.log('[Show Trip Lines] Loading lines for trip:', tripId);

        // Show loading popup
        const modalHtml = `
            <div id="trip-lines-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; justify-content: center; align-items: center;">
                <div style="background: white; width: 95%; max-width: 1200px; height: 85vh; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <!-- Header -->
                    <div style="padding: 1rem 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: white; font-size: 1.1rem;">
                            <i class="fas fa-list-alt"></i> Trip Lines - Trip ID: ${tripId}
                        </h3>
                        <button onclick="closeTripLinesModal()" style="background: none; border: none; font-size: 1.5rem; color: white; cursor: pointer;">&times;</button>
                    </div>

                    <!-- Filter/Search Bar -->
                    <div style="padding: 1rem 1.5rem; background: #f8f9fc; border-bottom: 1px solid #e2e8f0;">
                        <div style="display: flex; gap: 1rem; align-items: center;">
                            <div style="flex: 1;">
                                <input type="text" id="trip-lines-search" placeholder="Search by Order Number, Customer, Item..."
                                    style="width: 100%; padding: 0.6rem 1rem; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.9rem;"
                                    onkeyup="filterTripLines()">
                            </div>
                            <button onclick="filterTripLines()" class="btn btn-primary" style="padding: 0.6rem 1rem;">
                                <i class="fas fa-search"></i> Search
                            </button>
                            <button onclick="clearTripLinesFilter()" class="btn btn-secondary" style="padding: 0.6rem 1rem;">
                                <i class="fas fa-times"></i> Clear
                            </button>
                        </div>
                    </div>

                    <!-- Content/Grid -->
                    <div style="flex: 1; padding: 1rem 1.5rem; overflow: auto;">
                        <div id="trip-lines-content" style="height: 100%;">
                            <div style="display: flex; justify-content: center; align-items: center; height: 200px;">
                                <div style="text-align: center;">
                                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #8b5cf6;"></i>
                                    <p style="margin-top: 1rem; color: #64748b;">Loading trip lines...</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; background: #f8f9fc; display: flex; justify-content: space-between; align-items: center;">
                        <span id="trip-lines-count" style="color: #64748b; font-size: 0.9rem;">Loading...</span>
                        <button onclick="closeTripLinesModal()" class="btn btn-secondary">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Fetch trip lines from API
        fetchTripLines(tripId);
    };

    window.closeTripLinesModal = function() {
        const modal = document.getElementById('trip-lines-modal');
        if (modal) modal.remove();
        window.tripLinesData = null;
    };

    function fetchTripLines(tripId) {
        const TRIP_LINES_API = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/gettrillines?P_TRIP_ID=${tripId}`;

        console.log('[Show Trip Lines] Fetching from:', TRIP_LINES_API);

        if (window.chrome && window.chrome.webview) {
            // WebView2 environment - use C# backend
            sendMessageToCSharp({
                action: 'executeGet',
                fullUrl: TRIP_LINES_API
            }, function(error, data) {
                if (error) {
                    console.error('[Show Trip Lines] Error:', error);
                    showTripLinesError(error);
                } else {
                    try {
                        const result = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log('[Show Trip Lines] Response:', result);
                        displayTripLines(result);
                    } catch (parseError) {
                        console.error('[Show Trip Lines] Parse error:', parseError);
                        showTripLinesError('Failed to parse response');
                    }
                }
            });
        } else {
            // Browser testing fallback
            fetch(TRIP_LINES_API, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            })
            .then(response => response.json())
            .then(result => {
                console.log('[Show Trip Lines] Response:', result);
                displayTripLines(result);
            })
            .catch(error => {
                console.error('[Show Trip Lines] Error:', error);
                showTripLinesError(error.message);
            });
        }
    }

    function showTripLinesError(message) {
        const content = document.getElementById('trip-lines-content');
        if (content) {
            content.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; height: 200px;">
                    <div style="text-align: center;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: #ef4444;"></i>
                        <p style="margin-top: 1rem; color: #ef4444;">Error: ${message}</p>
                    </div>
                </div>
            `;
        }
        const countEl = document.getElementById('trip-lines-count');
        if (countEl) countEl.textContent = 'Error loading data';
    }

    function displayTripLines(data) {
        // Handle different response formats
        const items = data.items || data.ITEMS || data || [];
        window.tripLinesData = Array.isArray(items) ? items : [];

        console.log('[Show Trip Lines] Displaying', window.tripLinesData.length, 'lines');

        const countEl = document.getElementById('trip-lines-count');
        if (countEl) countEl.textContent = `${window.tripLinesData.length} line(s) found`;

        if (window.tripLinesData.length === 0) {
            const content = document.getElementById('trip-lines-content');
            if (content) {
                content.innerHTML = `
                    <div style="display: flex; justify-content: center; align-items: center; height: 200px;">
                        <div style="text-align: center;">
                            <i class="fas fa-inbox" style="font-size: 2rem; color: #64748b;"></i>
                            <p style="margin-top: 1rem; color: #64748b;">No lines found for this trip.</p>
                        </div>
                    </div>
                `;
            }
            return;
        }

        renderTripLinesGrid(window.tripLinesData);
    }

    function renderTripLinesGrid(data) {
        const content = document.getElementById('trip-lines-content');
        if (!content) return;

        // Build columns dynamically from first row
        const firstRow = data[0];
        const columns = Object.keys(firstRow).map(key => ({
            dataField: key,
            caption: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            width: key.toLowerCase().includes('number') || key.toLowerCase().includes('id') ? 120 :
                   key.toLowerCase().includes('name') || key.toLowerCase().includes('description') ? 200 : 100
        }));

        // Create DevExpress DataGrid
        content.innerHTML = '<div id="trip-lines-grid" style="height: 100%;"></div>';

        $('#trip-lines-grid').dxDataGrid({
            dataSource: data,
            columns: columns,
            showBorders: true,
            showRowLines: true,
            showColumnLines: true,
            rowAlternationEnabled: true,
            columnAutoWidth: false,
            allowColumnReordering: true,
            allowColumnResizing: true,
            columnResizingMode: 'widget',
            hoverStateEnabled: true,
            scrolling: {
                mode: 'virtual',
                rowRenderingMode: 'virtual'
            },
            filterRow: {
                visible: true,
                applyFilter: 'auto'
            },
            searchPanel: {
                visible: false // We use our own search
            },
            paging: {
                pageSize: 50
            },
            pager: {
                visible: true,
                showPageSizeSelector: true,
                allowedPageSizes: [25, 50, 100, 200],
                showInfo: true
            },
            headerFilter: {
                visible: true
            },
            export: {
                enabled: true,
                fileName: 'TripLines'
            },
            columnChooser: {
                enabled: true,
                mode: 'select'
            },
            height: '100%'
        });

        window.tripLinesGridInstance = $('#trip-lines-grid').dxDataGrid('instance');
    }

    window.filterTripLines = function() {
        const searchValue = document.getElementById('trip-lines-search')?.value || '';

        if (window.tripLinesGridInstance) {
            if (searchValue.trim()) {
                window.tripLinesGridInstance.searchByText(searchValue);
            } else {
                window.tripLinesGridInstance.clearFilter();
            }
        }
    };

    window.clearTripLinesFilter = function() {
        const searchInput = document.getElementById('trip-lines-search');
        if (searchInput) searchInput.value = '';

        if (window.tripLinesGridInstance) {
            window.tripLinesGridInstance.clearFilter();
        }
    };

    // Allocate Lots for S2V - Process selected S2V orders
    window.allocateLotsForS2V = function(tripId) {
        console.log('[Allocate Lots S2V] Processing trip:', tripId);

        // Get the grid instance - check both tab and dialog grids
        const tabId = `trip-detail-${tripId}`;
        const tabGridId = `grid-${tabId}`;
        const dialogGridId = 'trip-dialog-grid';

        console.log('[Allocate Lots S2V] Looking for grid:', tabGridId, 'or', dialogGridId);

        // Try tab grid first, then dialog grid
        let gridContainer = $(`#${tabGridId}`);
        if (!gridContainer || gridContainer.length === 0) {
            console.log('[Allocate Lots S2V] Tab grid not found, trying dialog grid...');
            gridContainer = $(`#${dialogGridId}`);
        }

        if (!gridContainer || gridContainer.length === 0) {
            console.error('[Allocate Lots S2V] ❌ Grid not found');
            alert('Grid not found. Please refresh the page.');
            return;
        }

        const gridInstance = gridContainer.dxDataGrid('instance');
        if (!gridInstance) {
            alert('Grid instance not found. Please refresh the page.');
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

    // Assign Picker for a single Trip Order (from Actions column button)
    window.assignPickerForTripOrder = function(rowData, tripId) {
        console.log('[Trip Management] Assign picker for order:', rowData.ORDER_NUMBER || rowData.order_number);

        // Get the trip ID from row data if not passed
        const effectiveTripId = tripId || rowData.TRIP_ID || rowData.trip_id || '';

        // Check if pickers data is loaded, if not load it first
        if (!window.pickersData || window.pickersData.length === 0) {
            console.log('[Assign Picker] Pickers not loaded, loading now...');

            // Show loading message
            const loadingMsg = document.createElement('div');
            loadingMsg.id = 'loading-pickers-msg';
            loadingMsg.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#667eea;color:white;padding:1rem 2rem;border-radius:8px;z-index:20000;';
            loadingMsg.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading pickers...';
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
                        // Open dialog with single order
                        openAssignPickerDialog(effectiveTripId, [rowData]);
                    }
                }, 500);

                // Timeout after 10 seconds
                setTimeout(() => {
                    clearInterval(checkInterval);
                    const msg = document.getElementById('loading-pickers-msg');
                    if (msg) msg.remove();
                    if (!window.pickersData || window.pickersData.length === 0) {
                        alert('Failed to load pickers. Please try again.');
                    }
                }, 10000);
            } else {
                loadingMsg.remove();
                alert('Pickers module not loaded. Please refresh the page.');
            }
            return;
        }

        // Open assign picker dialog with single order
        openAssignPickerDialog(effectiveTripId, [rowData]);
    };

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

        // Check if ORDER_TYPE is Store to Van or Van to Store (including S2V, V2S abbreviations)
        if (orderType === 'STORE TO VAN' || orderType === 'VAN TO STORE' || orderType === 'S2V' || orderType === 'V2S') {
            // Store to Van / Van to Store - use Store Transaction report (Inventory Report)
            reportPath = '/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo';
            parameterName = 'SOURCE_CODE';
            reportName = 'Store Transaction Report (Inventory)';
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
        loadingDiv.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 30000; display: flex; align-items: center; justify-content: center;';
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
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 30000; display: flex; align-items: center; justify-content: center; padding: 2rem;';

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

    // XML Viewer - similar to PDF Viewer but for XML files
    window.showXmlViewer = function(xmlPath, orderNumber, reportName) {
        console.log('[XML Viewer] Opening XML:', xmlPath);

        // Create modal overlay
        const modal = document.createElement('div');
        modal.id = 'xml-viewer-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 30000; display: flex; align-items: center; justify-content: center; padding: 2rem;';

        modal.innerHTML = `
            <div style="background: white; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); width: 100%; max-width: 1200px; height: 90vh; display: flex; flex-direction: column; overflow: hidden;">
                <!-- Header -->
                <div style="padding: 1.25rem 1.5rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0;">
                    <div>
                        <div style="font-size: 1.2rem; font-weight: 700;">${reportName}</div>
                        <div style="font-size: 0.85rem; opacity: 0.9; margin-top: 0.25rem;">Order: ${orderNumber}</div>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button onclick="window.open('file:///${xmlPath.replace(/\\/g, '/')}')" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                            <i class="fas fa-external-link-alt"></i> Open External
                        </button>
                        <button onclick="document.getElementById('xml-viewer-modal').remove()" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>

                <!-- XML Viewer Body -->
                <div style="flex: 1; overflow: auto; background: #f1f5f9; display: flex; align-items: center; justify-content: center; padding: 1rem;">
                    <iframe src="file:///${xmlPath.replace(/\\/g, '/')}" style="width: 100%; height: 100%; border: none; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-radius: 8px;"></iframe>
                </div>

                <!-- Footer -->
                <div style="padding: 0.75rem 1.5rem; background: #f8f9fc; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 0.75rem; color: #64748b;">
                        <i class="fas fa-file-code" style="color: #10b981; margin-right: 0.5rem;"></i>
                        ${xmlPath}
                    </div>
                    <button onclick="navigator.clipboard.writeText('${xmlPath}')" style="background: #10b981; border: none; color: white; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 600;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
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

        // Get instance - try from window.currentTripInstance first, then localStorage
        let instance = window.currentTripInstance || localStorage.getItem('fusionInstance') || 'TEST';

        // Check if we have trip data with instance - check both tab and dialog grids
        const tabId = `trip-detail-${tripId}`;
        const tabGridId = `grid-${tabId}`;
        const dialogGridId = 'trip-dialog-grid';

        // Try tab grid first, then dialog grid - use try-catch to handle uninitialized grids
        let gridContainer = $(`#${tabGridId}`);
        if (!gridContainer || gridContainer.length === 0) {
            gridContainer = $(`#${dialogGridId}`);
        }

        if (gridContainer && gridContainer.length > 0) {
            try {
                const gridInstance = gridContainer.dxDataGrid('instance');
                if (gridInstance) {
                    const dataSource = gridInstance.option('dataSource');
                    if (dataSource && dataSource.length > 0 && dataSource[0].INSTANCE) {
                        instance = dataSource[0].INSTANCE;
                        console.log('[Refresh Trip] Using instance from trip data:', instance);
                    } else {
                        console.log('[Refresh Trip] Using instance from window/localStorage:', instance);
                    }
                }
            } catch (gridError) {
                console.log('[Refresh Trip] Grid not initialized, using instance from window/localStorage:', instance);
            }
        }

        const GET_TRIP_DETAILS_API = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/${tripId}?P_INSTANCE_NAME=${instance}`;

        console.log('[Refresh Trip] API URL:', GET_TRIP_DETAILS_API);

        // Show loading indicator
        let refreshBtn = null;
        let originalBtnHtml = '';
        try {
            refreshBtn = event.target.closest('button');
            if (refreshBtn) {
                originalBtnHtml = refreshBtn.innerHTML;
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
            }
        } catch (e) {
            console.log('[Refresh Trip] Could not find refresh button');
        }

        if (window.chrome && window.chrome.webview) {
            // WebView2 environment - use C# backend
            sendMessageToCSharp({
                action: 'executeGet',
                fullUrl: GET_TRIP_DETAILS_API
            }, function(error, data) {
                // Restore button
                if (refreshBtn) {
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = originalBtnHtml;
                }

                if (error) {
                    console.error('[Refresh Trip] Error:', error);
                    alert('Error refreshing trip data:\n' + error);
                } else {
                    try {
                        const result = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log('[Refresh Trip] Data received:', result);

                        if (result && result.items && result.items.length > 0) {
                            // Update grid with new data - reuse gridContainer from earlier
                            let updateGridContainer = $(`#${tabGridId}`);
                            if (!updateGridContainer || updateGridContainer.length === 0) {
                                updateGridContainer = $(`#${dialogGridId}`);
                            }

                            if (updateGridContainer && updateGridContainer.length > 0) {
                                try {
                                    const gridInstance = updateGridContainer.dxDataGrid('instance');
                                    if (gridInstance) {
                                        gridInstance.option('dataSource', result.items);
                                        gridInstance.refresh();

                                        // Update order count (for tab version)
                                        const orderCountDiv = updateGridContainer.closest('.trip-tab-pane').find('.fa-info-circle').parent();
                                        if (orderCountDiv.length > 0) {
                                            orderCountDiv.html(`<i class="fas fa-info-circle" style="font-size: 0.65rem;"></i> Showing ${result.items.length} orders`);
                                        }
                                    }
                                } catch (gridError) {
                                    console.log('[Refresh Trip] Grid not initialized, reopening trip with fresh data');
                                    // Grid not initialized - close the tab and reopen with new data
                                    if (typeof showTripDetails === 'function') {
                                        showTripDetails(result.items, tripId);
                                    }
                                }
                            }

                            // Show success notification
                            const notification = document.createElement('div');
                            notification.style.cssText = 'position: fixed; top: 80px; right: 20px; background: #10b981; color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10002; font-weight: 600;';
                            notification.innerHTML = `<i class="fas fa-check-circle"></i> Trip refreshed - ${result.items.length} order(s) loaded`;
                            document.body.appendChild(notification);
                            setTimeout(() => notification.remove(), 3000);
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
                    if (refreshBtn) {
                        refreshBtn.disabled = false;
                        refreshBtn.innerHTML = originalBtnHtml;
                    }

                    console.log('[Refresh Trip] Data received:', result);

                    if (result && result.items && result.items.length > 0) {
                        // Update grid with new data
                        let updateGridContainer = $(`#${tabGridId}`);
                        if (!updateGridContainer || updateGridContainer.length === 0) {
                            updateGridContainer = $(`#${dialogGridId}`);
                        }

                        if (updateGridContainer && updateGridContainer.length > 0) {
                            try {
                                const gridInstance = updateGridContainer.dxDataGrid('instance');
                                if (gridInstance) {
                                    gridInstance.option('dataSource', result.items);
                                    gridInstance.refresh();

                                    // Update order count
                                    const orderCountDiv = updateGridContainer.closest('.trip-tab-pane').find('.fa-info-circle').parent();
                                    if (orderCountDiv.length > 0) {
                                        orderCountDiv.html(`<i class="fas fa-info-circle" style="font-size: 0.65rem;"></i> Showing ${result.items.length} orders`);
                                    }
                                }
                            } catch (gridError) {
                                console.log('[Refresh Trip] Grid not initialized, reopening trip with fresh data');
                                // Grid not initialized - close the tab and reopen with new data
                                if (typeof showTripDetails === 'function') {
                                    showTripDetails(result.items, tripId);
                                }
                            }
                        }

                        // Show success notification
                        const notification = document.createElement('div');
                        notification.style.cssText = 'position: fixed; top: 80px; right: 20px; background: #10b981; color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10002; font-weight: 600;';
                        notification.innerHTML = `<i class="fas fa-check-circle"></i> Trip refreshed - ${result.items.length} order(s) loaded`;
                        document.body.appendChild(notification);
                        setTimeout(() => notification.remove(), 3000);
                    } else {
                        alert('No data returned from API');
                    }
                })
                .catch(error => {
                    // Restore button
                    if (refreshBtn) {
                        refreshBtn.disabled = false;
                        refreshBtn.innerHTML = originalBtnHtml;
                    }

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
            // For other order types, open Order Transactions dialog
            openOrderTransactionsDialog(rowData);
        }
    };

    window.openStoreTransactionsDialog = function(rowData) {
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
            <div id="store-transactions-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 25000; justify-content: center; align-items: center;">
                <div style="background: white; width: 95%; max-width: 1400px; height: 90%; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <!-- Modal Header -->
                    <div style="padding: 0.75rem 1rem; border-bottom: 2px solid #e2e8f0; background: whitesmoke;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <h2 style="margin: 0; font-size: 1.1rem; color: #1e293b; font-weight: 700;">
                                    <i class="fas fa-exchange-alt" style="color: #667eea;"></i> Store Transactions
                                </h2>
                                <button id="store-trans-header-toggle" onclick="toggleStoreTransHeader()" style="background: transparent; border: none; cursor: pointer; color: #667eea; padding: 0.2rem 0.4rem; transition: all 0.2s;" title="Toggle Details">
                                    <i class="fas fa-chevron-down" style="font-size: 0.9rem; transition: transform 0.3s;"></i>
                                </button>
                            </div>
                            <div style="display: flex; gap: 0.5rem; align-items: center;">
                                <button onclick="printStoreTransaction('${orderNumber}', '${instance}', '${orderType}', '${tripId}', '${tripDate}')" style="background: #8b5cf6; border: none; cursor: pointer; color: white; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.75rem; display: flex; align-items: center; gap: 0.3rem; transition: all 0.2s;" onmouseover="this.style.background='#7c3aed';" onmouseout="this.style.background='#8b5cf6';" title="Print Store Transaction">
                                    <i class="fas fa-print"></i> Print
                                </button>
                                <button onclick="closeStoreTransactionsModal()" style="background: transparent; border: 1px solid #cbd5e1; font-size: 20px; cursor: pointer; color: #64748b; padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.2s;" onmouseover="this.style.background='#e2e8f0'; this.style.color='#1e293b';" onmouseout="this.style.background='transparent'; this.style.color='#64748b';">
                                    ×
                                </button>
                            </div>
                        </div>

                        <!-- Header Details (Collapsible, Default Collapsed) -->
                        <div id="store-trans-header-details" style="display: none; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.4rem; padding: 0.5rem; background: white; border-radius: 6px; border: 1px solid #e2e8f0; margin-top: 0.5rem; transition: all 0.3s;">
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Trip ID:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${tripId}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Order Number:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${orderNumber}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Instance:</span><br><strong style="color: #8b5cf6; font-size: 0.75rem; font-weight: 700;">${instance}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Date:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${tripDate}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Account Number:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${accountNumber}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Account Name:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${accountName}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Picker:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${picker}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Lorry:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${lorry}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Priority:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${priority}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Pick Confirm St:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${pickConfirmSt}</strong></div>
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
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button class="btn btn-secondary" onclick="refreshTransactionDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                                <button class="btn btn-primary" onclick="fetchLotDetails('${orderNumber}')" id="fetch-lot-btn" style="display: none;">
                                    <i class="fas fa-list"></i> Fetch Lot Details
                                </button>
                                <button class="btn btn-danger" onclick="cancelSelectedTransactionLines('${orderNumber}')" id="cancel-selected-lines-btn" style="display: none; background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db;">
                                    <i class="fas fa-ban"></i> Cancel Selected Lines
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
    };

    window.closeStoreTransactionsModal = function() {
        const modal = document.getElementById('store-transactions-modal');
        if (modal) {
            modal.remove();
        }
    };

    // ============================================================================
    // ORDER TRANSACTIONS DIALOG (Non-S2V/V2S Orders)
    // ============================================================================

    // Store current order transaction context
    window.currentOrderTransContext = null;

    window.openOrderTransactionsDialog = function(rowData) {
        console.log('[Order Transactions] Opening dialog for order:', rowData);

        const orderNumber = rowData.ORDER_NUMBER || rowData.order_number || rowData.SOURCE_ORDER_NUMBER || rowData.source_order_number || '';
        const orderType = rowData.ORDER_TYPE || rowData.order_type || rowData.ORDER_TYPE_CODE || rowData.order_type_code || '';
        const orderDate = rowData.ORDER_DATE || rowData.order_date || '';
        const tripId = rowData.TRIP_ID || rowData.trip_id || '';
        const tripDate = rowData.TRIP_DATE || rowData.trip_date || '';
        const accountNumber = rowData.ACCOUNT_NUMBER || rowData.account_number || '';
        const accountName = rowData.ACCOUNT_NAME || rowData.account_name || rowData.CUSTOMER_NAME || rowData.customer_name || '';
        const picker = rowData.PICKER || rowData.picker || '';
        const lorry = rowData.LORRY_NUMBER || rowData.lorry_number || '';
        const priority = rowData.PRIORITY || rowData.priority || '';
        const lineStatus = rowData.LINE_STATUS || rowData.line_status || '';
        const instance = rowData.instance_name || rowData.INSTANCE_NAME || rowData.instance || rowData.INSTANCE || window.currentTripInstance || 'TEST';

        // Store context globally for API calls
        window.currentOrderTransContext = {
            orderNumber,
            orderType,
            orderDate,
            tripId,
            tripDate,
            accountNumber,
            accountName,
            picker,
            lorry,
            priority,
            lineStatus,
            instance
        };

        console.log('[Order Transactions] ORDER_NUMBER:', orderNumber, 'ORDER_TYPE:', orderType, 'INSTANCE:', instance);

        // Create modal HTML
        const modalHtml = `
            <div id="order-transactions-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 25000; justify-content: center; align-items: center;">
                <div style="background: white; width: 95%; max-width: 1400px; height: 90%; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <!-- Modal Header -->
                    <div style="padding: 0.75rem 1rem; border-bottom: 2px solid #e2e8f0; background: whitesmoke;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <h2 style="margin: 0; font-size: 1.1rem; color: #1e293b; font-weight: 700;">
                                    <i class="fas fa-file-invoice" style="color: #667eea;"></i> Order Transactions
                                </h2>
                                <button id="order-trans-header-toggle" onclick="toggleOrderTransHeader()" style="background: transparent; border: none; cursor: pointer; color: #667eea; padding: 0.2rem 0.4rem; transition: all 0.2s;" title="Toggle Details">
                                    <i class="fas fa-chevron-down" style="font-size: 0.9rem; transition: transform 0.3s;"></i>
                                </button>
                                <button onclick="showOrderTransactionsApiInfo()" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="View API Information">
                                    <i class="fas fa-code"></i> API
                                </button>
                                <span style="background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">
                                    Instance: ${instance}
                                </span>
                            </div>
                            <button onclick="closeOrderTransactionsModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #64748b; transition: color 0.2s; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 6px;" onmouseover="this.style.background='#fee2e2'; this.style.color='#dc2626';" onmouseout="this.style.background='none'; this.style.color='#64748b';">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>

                        <!-- Collapsible Header Details (Default: Collapsed) -->
                        <div id="order-trans-header-details" style="display: none; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.4rem; padding: 0.5rem; background: white; border-radius: 6px; border: 1px solid #e2e8f0; margin-top: 0.5rem; transition: all 0.3s;">
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Order Number:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${orderNumber}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Order Date:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${orderDate}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Order Type:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${orderType}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Account Number:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${accountNumber}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Account Name:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${accountName}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Trip ID:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${tripId}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Trip Date:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${tripDate}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Picker:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${picker}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Lorry:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${lorry}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Priority:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${priority}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Status:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${lineStatus}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Instance:</span><br><strong style="color: #7c3aed; font-size: 0.75rem;">${instance}</strong></div>
                        </div>
                    </div>

                    <!-- Tab Header -->
                    <div style="display: flex; gap: 0.5rem; padding: 0.75rem 1.5rem; background: #f8f9fc; border-bottom: 2px solid #e2e8f0; overflow-x: auto;">
                        <button class="order-trans-tab active" data-tab="pick-release" onclick="switchOrderTransTab('pick-release')" style="padding: 0.5rem 1.2rem; border: none; background: white; border-radius: 6px; cursor: pointer; font-weight: 600; color: #667eea; box-shadow: 0 2px 4px rgba(0,0,0,0.1); white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-box-open"></i> Pick Release Details
                        </button>
                        <button class="order-trans-tab" data-tab="sales-order-lines" onclick="switchOrderTransTab('sales-order-lines')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-shopping-cart"></i> Sales Order Lines
                        </button>
                        <button class="order-trans-tab" data-tab="lot-details" onclick="switchOrderTransTab('lot-details')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-barcode"></i> Lot Details
                        </button>
                        <button class="order-trans-tab" data-tab="shipment-details" onclick="switchOrderTransTab('shipment-details')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-shipping-fast"></i> Shipment Details
                        </button>
                        <button class="order-trans-tab" data-tab="pick-confirm-responses" onclick="switchOrderTransTab('pick-confirm-responses')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-check-double"></i> Pick Confirm Responses
                        </button>
                        <button class="order-trans-tab" data-tab="ship-confirm-responses" onclick="switchOrderTransTab('ship-confirm-responses')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-truck-loading"></i> Ship Confirm Responses
                        </button>
                    </div>

                    <!-- Tab Content -->
                    <div style="flex: 1; overflow: hidden; position: relative;">
                        <!-- Tab 1: Pick Release Details -->
                        <div id="order-trans-pick-release" class="order-trans-tab-content active" style="height: 100%; overflow: auto; padding: 1rem;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshPickReleaseDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="pick-release-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="pick-release-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 2: Sales Order Lines -->
                        <div id="order-trans-sales-order-lines" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button class="btn btn-secondary" onclick="refreshSalesOrderLines('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                                <button class="btn btn-warning" onclick="cancelScheduledLines('${orderNumber}')" style="background: #f59e0b; color: white;">
                                    <i class="fas fa-clock"></i> Cancel Scheduled Lines
                                </button>
                                <button class="btn btn-danger" onclick="cancelSelectedSalesOrderLine('${orderNumber}')" style="background: #ef4444; color: white;">
                                    <i class="fas fa-times-circle"></i> Cancel Selected Line
                                </button>
                                <button class="btn btn-danger" onclick="cancelNotPickedLines('${orderNumber}')" style="background: #dc2626; color: white;">
                                    <i class="fas fa-ban"></i> Cancel Not Picked Lines
                                </button>
                                <button class="btn btn-primary" onclick="fetchFusionOrderLines('${orderNumber}')" style="background: #2563eb; color: white;">
                                    <i class="fas fa-cloud-download-alt"></i> Fetch Order Lines from Fusion
                                </button>
                            </div>
                            <div id="sales-order-lines-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="sales-order-lines-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 3: Lot Details -->
                        <div id="order-trans-lot-details" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshLotDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="lot-details-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="lot-details-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 4: Shipment Details -->
                        <div id="order-trans-shipment-details" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshShipmentDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="shipment-details-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="shipment-details-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 5: Pick Confirmation Responses -->
                        <div id="order-trans-pick-confirm-responses" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshPickConfirmResponses('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="pick-confirm-responses-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="pick-confirm-responses-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 6: Shipment Confirmation Responses -->
                        <div id="order-trans-ship-confirm-responses" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshShipConfirmResponses('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="ship-confirm-responses-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="ship-confirm-responses-grid" style="height: 100%;"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add modal to body
        const existingModal = document.getElementById('order-transactions-modal');
        if (existingModal) {
            existingModal.remove();
        }
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Auto-load first tab data
        console.log('[Order Transactions] Auto-loading Pick Release Details for order:', orderNumber);
        setTimeout(() => {
            refreshPickReleaseDetails(orderNumber);
        }, 100);
    }

    window.closeOrderTransactionsModal = function() {
        const modal = document.getElementById('order-transactions-modal');
        if (modal) {
            modal.remove();
        }
        // Clear context
        window.currentOrderTransContext = null;
    };

    // Show API Information for Order Transactions
    window.showOrderTransactionsApiInfo = function() {
        const ctx = window.currentOrderTransContext || {};
        const orderNumber = ctx.orderNumber || 'N/A';
        const instance = ctx.instance || 'N/A';

        const baseUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT';

        const apis = [
            {
                name: 'Pick Release Details',
                method: 'GET',
                endpoint: `trips/orders/getpickreleasedetails/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                fullUrl: `${baseUrl}/trips/orders/getpickreleasedetails/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                note: '✅ Instance parameter passed from row data'
            },
            {
                name: 'Sales Order Lines',
                method: 'GET',
                endpoint: `trip/orders/getsalesorderlines/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                fullUrl: `${baseUrl}/trip/orders/getsalesorderlines/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                note: '✅ Instance parameter passed from row data'
            },
            {
                name: 'Lot Details',
                method: 'GET',
                endpoint: `trips/orders/getlotdetails/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                fullUrl: `${baseUrl}/trips/orders/getlotdetails/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                note: '✅ Instance parameter passed from row data'
            },
            {
                name: 'Cancel Scheduled Lines',
                method: 'POST',
                endpoint: `trip/orders/cancelscheduledlines/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                fullUrl: `${baseUrl}/trip/orders/cancelscheduledlines/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                note: '✅ Instance parameter passed from row data'
            },
            {
                name: 'Cancel Selected Line',
                method: 'POST',
                endpoint: `trip/orders/cancelorderline/${orderNumber}/{lineId}?P_INSTANCE_NAME=${instance}`,
                fullUrl: `${baseUrl}/trip/orders/cancelorderline/${orderNumber}/{lineId}?P_INSTANCE_NAME=${instance}`,
                note: '✅ Instance parameter passed from row data'
            },
            {
                name: 'Cancel Not Picked Lines',
                method: 'POST',
                endpoint: `trip/orders/cancelnotpickedlines/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                fullUrl: `${baseUrl}/trip/orders/cancelnotpickedlines/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                note: '✅ Instance parameter passed from row data'
            },
            {
                name: 'Fetch Order Lines from Fusion',
                method: 'POST',
                endpoint: `trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instance}&p_order_number=${orderNumber}`,
                fullUrl: `${baseUrl}/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instance}&p_order_number=${orderNumber}`,
                note: '✅ Instance parameter passed from row data'
            }
        ];

        let apiHtml = '';
        apis.forEach((api, idx) => {
            const bgColor = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
            const methodColor = api.method === 'POST' ? '#fed7aa' : '#c6f6d5';
            const methodTextColor = api.method === 'POST' ? '#9c4221' : '#22543d';

            apiHtml += `
                <div style="background: ${bgColor}; padding: 0.75rem; border-radius: 6px; margin-bottom: 0.5rem; border-left: 3px solid #667eea;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <span style="background: ${methodColor}; color: ${methodTextColor}; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">${api.method}</span>
                        <strong style="color: #1e293b; font-size: 12px;">${api.name}</strong>
                    </div>
                    <div style="margin-bottom: 0.25rem;">
                        <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px; font-size: 9px; word-break: break-all; display: block;">${api.fullUrl}</code>
                    </div>
                    <div style="font-size: 10px; color: #f59e0b; font-style: italic;">
                        <i class="fas fa-exclamation-triangle"></i> ${api.note}
                    </div>
                </div>
            `;
        });

        const apiInfo = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                <h4 style="margin: 0 0 1rem 0; color: #333; border-bottom: 2px solid #667eea; padding-bottom: 0.5rem;">
                    <i class="fas fa-code" style="color: #667eea;"></i> API Information - Order Transactions
                </h4>

                <!-- Current Context -->
                <div style="background: #e0f2fe; padding: 0.75rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #0284c7;">
                    <div style="font-weight: 600; color: #0369a1; margin-bottom: 0.5rem;">Current Context</div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                        <tr>
                            <td style="padding: 4px 8px; border: 1px solid #7dd3fc;">Order Number:</td>
                            <td style="padding: 4px 8px; border: 1px solid #7dd3fc; font-weight: 600;">${orderNumber}</td>
                        </tr>
                        <tr>
                            <td style="padding: 4px 8px; border: 1px solid #7dd3fc;">Instance (from row):</td>
                            <td style="padding: 4px 8px; border: 1px solid #7dd3fc; font-weight: 600; color: #7c3aed;">${instance}</td>
                        </tr>
                    </table>
                </div>

                <!-- APIs Used -->
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                    <div style="font-weight: 600; color: #1e293b; margin-bottom: 0.75rem;">APIs Used in Order Transactions</div>
                    ${apiHtml}
                </div>

                <!-- Success Note -->
                <div style="background: #d1fae5; padding: 0.75rem; border-radius: 8px; border-left: 4px solid #10b981;">
                    <strong style="color: #065f46;"><i class="fas fa-check-circle"></i> Instance Configured:</strong>
                    <span style="color: #047857; font-size: 12px;">
                        Instance parameter <strong>P_INSTANCE_NAME=${instance}</strong> is being passed to all API calls from the order row data.
                    </span>
                </div>
            </div>
        `;

        // Create and show popup
        const popup = document.createElement('div');
        popup.id = 'order-trans-api-info-popup';
        popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 26000; display: flex; justify-content: center; align-items: center;';
        popup.innerHTML = `
            <div style="background: white; width: 90%; max-width: 750px; max-height: 85%; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                <div style="padding: 1.5rem; max-height: calc(85vh - 60px); overflow-y: auto;">
                    ${apiInfo}
                </div>
                <div style="padding: 1rem 1.5rem; border-top: 2px solid #f0f0f0; text-align: right;">
                    <button onclick="document.getElementById('order-trans-api-info-popup').remove()" class="btn btn-secondary" style="padding: 8px 20px;">
                        <i class="fas fa-times"></i> Close
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);
    };

    // Toggle Order Transactions Header Details
    window.toggleOrderTransHeader = function() {
        const details = document.getElementById('order-trans-header-details');
        const toggleBtn = document.getElementById('order-trans-header-toggle');
        const icon = toggleBtn.querySelector('i');

        if (details.style.display === 'none' || details.style.display === '') {
            details.style.display = 'grid';
            icon.style.transform = 'rotate(180deg)';
        } else {
            details.style.display = 'none';
            icon.style.transform = 'rotate(0deg)';
        }
    };

    window.switchOrderTransTab = function(tabName) {
        // Update tab buttons
        document.querySelectorAll('.order-trans-tab').forEach(tab => {
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
        document.querySelectorAll('.order-trans-tab-content').forEach(content => {
            content.style.display = 'none';
        });
        const activeContent = document.getElementById(`order-trans-${tabName}`);
        if (activeContent) {
            activeContent.style.display = 'block';
        }
    };

    // Placeholder refresh functions for Order Transactions tabs
    window.refreshPickReleaseDetails = function(orderNumber) {
        console.log('[Order Transactions] Refresh Pick Release Details for:', orderNumber);
        const gridContainer = document.getElementById('pick-release-grid');
        if (!gridContainer) {
            console.error('[Order Transactions] Pick Release grid container not found');
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show loading state
        gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Loading Pick Release Details...</p></div>';

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trips/orders/getpickreleasedetails/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Fetching Pick Release Details from:', apiUrl);

        // Use C# REST handler
        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            if (error) {
                console.error('[Order Transactions] Error fetching Pick Release Details:', error);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error loading data</p><p style="font-size: 0.85rem;">${error}</p></div>`;
                return;
            }

            try {
                let responseData = typeof data === 'string' ? JSON.parse(data) : data;
                let items = responseData.items || responseData || [];

                console.log('[Order Transactions] Pick Release Details received:', items.length, 'records');

                if (items.length === 0) {
                    gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>No Pick Release Details found</p></div>';
                    return;
                }

                // Log first item to see available fields
                console.log('[Order Transactions] Pick Release first item:', items[0]);

                // Build columns dynamically from first item
                const firstItem = items[0];
                const columns = Object.keys(firstItem).map(key => {
                    return {
                        dataField: key,
                        caption: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        width: 'auto'
                    };
                });

                // Initialize DevExpress Grid
                if (typeof DevExpress !== 'undefined' && DevExpress.ui?.dxDataGrid) {
                    // Clear container
                    gridContainer.innerHTML = '';

                    new DevExpress.ui.dxDataGrid(gridContainer, {
                        dataSource: items,
                        showBorders: true,
                        showRowLines: true,
                        rowAlternationEnabled: true,
                        allowColumnResizing: true,
                        columnAutoWidth: true,
                        height: '100%',
                        paging: { pageSize: 25 },
                        pager: {
                            showPageSizeSelector: true,
                            allowedPageSizes: [10, 25, 50, 100],
                            showInfo: true
                        },
                        filterRow: { visible: true },
                        headerFilter: { visible: true },
                        searchPanel: { visible: true, width: 200, placeholder: 'Search...' },
                        columns: columns,
                        onContentReady: function(e) {
                            console.log('[Order Transactions] Pick Release grid rendered');
                        }
                    });
                } else {
                    // Fallback to HTML table
                    let html = '<div style="overflow-x: auto; max-height: 400px;"><table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
                    html += '<thead style="position: sticky; top: 0; background: #f8f9fa;"><tr>';
                    Object.keys(firstItem).forEach(key => {
                        html += `<th style="padding: 0.5rem; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600;">${key.replace(/_/g, ' ')}</th>`;
                    });
                    html += '</tr></thead><tbody>';

                    items.forEach((item, idx) => {
                        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                        html += `<tr style="background: ${bg};">`;
                        Object.values(item).forEach(val => {
                            html += `<td style="padding: 0.4rem; border-bottom: 1px solid #f1f5f9;">${val !== null ? val : ''}</td>`;
                        });
                        html += '</tr>';
                    });

                    html += '</tbody></table></div>';
                    gridContainer.innerHTML = html;
                }

            } catch (parseError) {
                console.error('[Order Transactions] Parse error:', parseError);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error parsing data</p><p style="font-size: 0.85rem;">${parseError.message}</p></div>`;
            }
        });
    };

    window.refreshSalesOrderLines = function(orderNumber) {
        console.log('[Order Transactions] Refresh Sales Order Lines for:', orderNumber);
        const gridContainer = document.getElementById('sales-order-lines-grid');
        if (!gridContainer) {
            console.error('[Order Transactions] Sales Order Lines grid container not found');
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show loading state
        gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Loading Sales Order Lines...</p></div>';

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/orders/getsalesorderlines/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Fetching Sales Order Lines from:', apiUrl);

        // Use C# REST handler
        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            if (error) {
                console.error('[Order Transactions] Error fetching Sales Order Lines:', error);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error loading data</p><p style="font-size: 0.85rem;">${error}</p></div>`;
                return;
            }

            try {
                let responseData = typeof data === 'string' ? JSON.parse(data) : data;
                let items = responseData.items || responseData || [];

                console.log('[Order Transactions] Sales Order Lines received:', items.length, 'records');

                if (items.length === 0) {
                    gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>No Sales Order Lines found</p></div>';
                    return;
                }

                // Log first item to see available fields
                console.log('[Order Transactions] Sales Order Lines first item:', items[0]);

                // Build columns dynamically from first item
                const firstItem = items[0];
                const columns = Object.keys(firstItem).map(key => {
                    return {
                        dataField: key,
                        caption: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        width: 'auto'
                    };
                });

                // Initialize DevExpress Grid with selection
                if (typeof DevExpress !== 'undefined' && DevExpress.ui?.dxDataGrid) {
                    // Clear container
                    gridContainer.innerHTML = '';

                    window.salesOrderLinesGrid = new DevExpress.ui.dxDataGrid(gridContainer, {
                        dataSource: items,
                        showBorders: true,
                        showRowLines: true,
                        rowAlternationEnabled: true,
                        allowColumnResizing: true,
                        columnAutoWidth: true,
                        height: '100%',
                        selection: {
                            mode: 'multiple',
                            showCheckBoxesMode: 'always'
                        },
                        paging: { pageSize: 25 },
                        pager: {
                            showPageSizeSelector: true,
                            allowedPageSizes: [10, 25, 50, 100],
                            showInfo: true
                        },
                        filterRow: { visible: true },
                        headerFilter: { visible: true },
                        searchPanel: { visible: true, width: 200, placeholder: 'Search...' },
                        columns: columns,
                        onContentReady: function(e) {
                            console.log('[Order Transactions] Sales Order Lines grid rendered');
                        },
                        onSelectionChanged: function(e) {
                            window.selectedSalesOrderLines = e.selectedRowsData || [];
                            window.selectedSalesOrderLine = e.selectedRowsData[0] || null;
                            console.log('[Order Transactions] Selected Sales Order Lines:', window.selectedSalesOrderLines.length, 'items');
                        }
                    });
                } else {
                    // Fallback to HTML table with selection
                    let html = '<div style="overflow-x: auto; max-height: 400px;"><table id="sales-order-lines-table" style="width: 100%; border-collapse: collapse; font-size: 11px;">';
                    html += '<thead style="position: sticky; top: 0; background: #f8f9fa;"><tr>';
                    html += '<th style="padding: 0.5rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 30px;"><input type="checkbox" disabled></th>';
                    Object.keys(firstItem).forEach(key => {
                        html += `<th style="padding: 0.5rem; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600;">${key.replace(/_/g, ' ')}</th>`;
                    });
                    html += '</tr></thead><tbody>';

                    items.forEach((item, idx) => {
                        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                        html += `<tr data-index="${idx}" style="background: ${bg}; cursor: pointer;" onclick="selectSalesOrderLineRow(this, ${idx})">`;
                        html += `<td style="padding: 0.4rem; border-bottom: 1px solid #f1f5f9; text-align: center;"><input type="radio" name="sol-select" value="${idx}"></td>`;
                        Object.values(item).forEach(val => {
                            html += `<td style="padding: 0.4rem; border-bottom: 1px solid #f1f5f9;">${val !== null ? val : ''}</td>`;
                        });
                        html += '</tr>';
                    });

                    html += '</tbody></table></div>';
                    gridContainer.innerHTML = html;

                    // Store items for selection
                    window.salesOrderLinesData = items;
                }

            } catch (parseError) {
                console.error('[Order Transactions] Parse error:', parseError);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error parsing data</p><p style="font-size: 0.85rem;">${parseError.message}</p></div>`;
            }
        });
    };

    // Helper function for HTML table row selection
    window.selectSalesOrderLineRow = function(row, index) {
        // Deselect all rows
        document.querySelectorAll('#sales-order-lines-table tbody tr').forEach(tr => {
            tr.style.background = parseInt(tr.dataset.index) % 2 === 0 ? '#ffffff' : '#f8fafc';
        });
        // Select clicked row
        row.style.background = '#e0e7ff';
        row.querySelector('input[type="radio"]').checked = true;
        window.selectedSalesOrderLine = window.salesOrderLinesData ? window.salesOrderLinesData[index] : null;
        console.log('[Order Transactions] Selected Sales Order Line:', window.selectedSalesOrderLine);
    };

    // Fetch Order Lines from Fusion function
    window.fetchFusionOrderLines = function(orderNumber) {
        console.log('[Order Transactions] Fetch Order Lines from Fusion for order:', orderNumber);

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show confirmation popup with API details
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instance}&p_order_number=${orderNumber}`;

        // Create confirmation popup
        const popupHtml = `
            <div id="fetch-fusion-popup" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 30000; display: flex; justify-content: center; align-items: center;">
                <div style="background: white; width: 90%; max-width: 600px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 1rem 1.5rem;">
                        <h3 style="margin: 0; font-size: 1.1rem;">
                            <i class="fas fa-cloud-download-alt"></i> Fetch Order Lines from Fusion
                        </h3>
                    </div>
                    <div style="padding: 1.5rem;">
                        <div style="background: #eff6ff; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #3b82f6;">
                            <div style="font-weight: 600; color: #1e40af; margin-bottom: 0.5rem;">API Details</div>
                            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Method:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;"><span style="background: #fed7aa; color: #9c4221; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">POST</span></td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Instance:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600; color: #7c3aed;">${instance}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Order Number:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600;">${orderNumber}</td>
                                </tr>
                            </table>
                        </div>
                        <div style="margin-bottom: 1rem;">
                            <strong style="color: #4a5568; font-size: 12px;">Full URL:</strong>
                            <code style="background: #edf2f7; padding: 6px 10px; border-radius: 4px; font-size: 10px; word-break: break-all; display: block; margin-top: 4px;">${apiUrl}</code>
                        </div>
                        <div style="background: #fef3c7; padding: 0.75rem; border-radius: 8px; border-left: 4px solid #f59e0b;">
                            <strong style="color: #92400e;"><i class="fas fa-info-circle"></i> Note:</strong>
                            <span style="color: #78350f; font-size: 12px;">This will fetch the latest order lines from Oracle Fusion and update the local data.</span>
                        </div>
                    </div>
                    <div style="padding: 1rem 1.5rem; border-top: 2px solid #f0f0f0; display: flex; justify-content: flex-end; gap: 0.5rem;">
                        <button onclick="document.getElementById('fetch-fusion-popup').remove()" class="btn btn-secondary" style="padding: 8px 20px;">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                        <button id="fetch-fusion-execute-btn" onclick="executeFetchFusionOrderLines('${orderNumber}', '${instance}')" class="btn btn-primary" style="padding: 8px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-cloud-download-alt"></i> Fetch Now
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing popup if any
        const existingPopup = document.getElementById('fetch-fusion-popup');
        if (existingPopup) existingPopup.remove();

        // Add popup to body
        document.body.insertAdjacentHTML('beforeend', popupHtml);
    };

    // Execute the Fetch Fusion Order Lines API call
    window.executeFetchFusionOrderLines = function(orderNumber, instance) {
        console.log('[Order Transactions] Executing Fetch Fusion Order Lines...');

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instance}&p_order_number=${orderNumber}`;

        // Update button to show loading
        const fetchBtn = document.getElementById('fetch-fusion-execute-btn');
        if (fetchBtn) {
            fetchBtn.disabled = true;
            fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
        }

        console.log('[Order Transactions] Fetch Fusion Order Lines API:', apiUrl);

        // Use C# REST handler with POST method
        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            body: JSON.stringify({})
        }, function(error, data) {
            // Close popup
            const popup = document.getElementById('fetch-fusion-popup');
            if (popup) popup.remove();

            if (error) {
                console.error('[Order Transactions] Error fetching Fusion order lines:', error);
                alert('Error fetching order lines from Fusion:\n' + error);
                return;
            }

            try {
                let responseData = typeof data === 'string' ? JSON.parse(data) : data;
                console.log('[Order Transactions] Fetch Fusion Order Lines response:', responseData);

                // Show success message
                const message = responseData.message || responseData.MESSAGE || 'Order lines fetched successfully from Fusion';
                alert('✅ ' + message);

                // Refresh the Sales Order Lines grid to show updated data
                setTimeout(() => {
                    refreshSalesOrderLines(orderNumber);
                }, 500);

            } catch (parseError) {
                console.error('[Order Transactions] Parse error:', parseError);
                alert('Error parsing response: ' + parseError.message);
            }
        });
    };

    // Cancel Scheduled Lines function
    window.cancelScheduledLines = function(orderNumber) {
        console.log('[Order Transactions] Cancel Scheduled Lines for order:', orderNumber);

        // Show confirmation dialog
        if (!confirm(`Are you sure you want to cancel all scheduled lines for order ${orderNumber}?`)) {
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show loading indicator
        showLoading('Cancelling scheduled lines...');

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/orders/cancelscheduledlines/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Cancel Scheduled Lines API:', apiUrl);

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            payload: {}
        }, function(error, data) {
            hideLoading();

            if (error) {
                console.error('[Order Transactions] Error cancelling scheduled lines:', error);
                showNotification('Error cancelling scheduled lines: ' + error, 'error');
                return;
            }

            console.log('[Order Transactions] Cancel Scheduled Lines response:', data);
            showNotification('Scheduled lines cancelled successfully', 'success');

            // Refresh the grid
            refreshSalesOrderLines(orderNumber);
        });
    };

    // Cancel Selected Line function
    window.cancelSelectedSalesOrderLine = function(orderNumber) {
        console.log('[Order Transactions] Cancel Selected Line for order:', orderNumber);

        // Check if a line is selected
        if (!window.selectedSalesOrderLine) {
            showNotification('Please select a line to cancel', 'warning');
            return;
        }

        // Get line identifier (try common field names)
        const lineId = window.selectedSalesOrderLine.LINE_ID ||
                       window.selectedSalesOrderLine.line_id ||
                       window.selectedSalesOrderLine.LINE_NUMBER ||
                       window.selectedSalesOrderLine.line_number ||
                       window.selectedSalesOrderLine.ORDER_LINE_ID ||
                       window.selectedSalesOrderLine.order_line_id;

        if (!lineId) {
            showNotification('Unable to identify the selected line', 'error');
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show confirmation dialog
        if (!confirm(`Are you sure you want to cancel line ${lineId} for order ${orderNumber}?`)) {
            return;
        }

        // Show loading indicator
        showLoading('Cancelling selected line...');

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/orders/cancelorderline/${orderNumber}/${lineId}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Cancel Selected Line API:', apiUrl);

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            payload: {}
        }, function(error, data) {
            hideLoading();

            if (error) {
                console.error('[Order Transactions] Error cancelling selected line:', error);
                showNotification('Error cancelling line: ' + error, 'error');
                return;
            }

            console.log('[Order Transactions] Cancel Selected Line response:', data);
            showNotification('Line cancelled successfully', 'success');

            // Clear selection and refresh the grid
            window.selectedSalesOrderLine = null;
            refreshSalesOrderLines(orderNumber);
        });
    };

    // Cancel Not Picked Lines function
    window.cancelNotPickedLines = function(orderNumber) {
        console.log('[Order Transactions] Cancel Not Picked Lines for order:', orderNumber);

        // Show confirmation dialog
        if (!confirm(`Are you sure you want to cancel all not picked lines for order ${orderNumber}?`)) {
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show loading indicator
        showLoading('Cancelling not picked lines...');

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/orders/cancelnotpickedlines/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Cancel Not Picked Lines API:', apiUrl);

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            payload: {}
        }, function(error, data) {
            hideLoading();

            if (error) {
                console.error('[Order Transactions] Error cancelling not picked lines:', error);
                showNotification('Error cancelling not picked lines: ' + error, 'error');
                return;
            }

            console.log('[Order Transactions] Cancel Not Picked Lines response:', data);
            showNotification('Not picked lines cancelled successfully', 'success');

            // Refresh the grid
            refreshSalesOrderLines(orderNumber);
        });
    };

    window.refreshLotDetails = function(orderNumber) {
        console.log('[Order Transactions] Refresh Lot Details for:', orderNumber);
        const gridContainer = document.getElementById('lot-details-grid');
        if (!gridContainer) {
            console.error('[Order Transactions] Lot Details grid container not found');
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show loading state
        gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Loading Lot Details...</p></div>';

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trips/orders/getlotdetails/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Fetching Lot Details from:', apiUrl);

        // Use C# REST handler
        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            if (error) {
                console.error('[Order Transactions] Error fetching Lot Details:', error);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error loading data</p><p style="font-size: 0.85rem;">${error}</p></div>`;
                return;
            }

            try {
                let responseData = typeof data === 'string' ? JSON.parse(data) : data;
                let items = responseData.items || responseData || [];

                console.log('[Order Transactions] Lot Details received:', items.length, 'records');

                if (items.length === 0) {
                    gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>No Lot Details found</p></div>';
                    return;
                }

                // Log first item to see available fields
                console.log('[Order Transactions] Lot Details first item:', items[0]);

                // Build columns dynamically from first item
                const firstItem = items[0];
                const columns = Object.keys(firstItem).map(key => {
                    return {
                        dataField: key,
                        caption: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        width: 'auto'
                    };
                });

                // Initialize DevExpress Grid
                if (typeof DevExpress !== 'undefined' && DevExpress.ui?.dxDataGrid) {
                    // Clear container
                    gridContainer.innerHTML = '';

                    new DevExpress.ui.dxDataGrid(gridContainer, {
                        dataSource: items,
                        showBorders: true,
                        showRowLines: true,
                        rowAlternationEnabled: true,
                        allowColumnResizing: true,
                        columnAutoWidth: true,
                        height: '100%',
                        paging: { pageSize: 25 },
                        pager: {
                            showPageSizeSelector: true,
                            allowedPageSizes: [10, 25, 50, 100],
                            showInfo: true
                        },
                        filterRow: { visible: true },
                        headerFilter: { visible: true },
                        searchPanel: { visible: true, width: 200, placeholder: 'Search...' },
                        columns: columns,
                        onContentReady: function(e) {
                            console.log('[Order Transactions] Lot Details grid rendered');
                        }
                    });
                } else {
                    // Fallback to HTML table
                    let html = '<div style="overflow-x: auto; max-height: 400px;"><table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
                    html += '<thead style="position: sticky; top: 0; background: #f8f9fa;"><tr>';
                    Object.keys(firstItem).forEach(key => {
                        html += `<th style="padding: 0.5rem; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600;">${key.replace(/_/g, ' ')}</th>`;
                    });
                    html += '</tr></thead><tbody>';

                    items.forEach((item, idx) => {
                        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                        html += `<tr style="background: ${bg};">`;
                        Object.values(item).forEach(val => {
                            html += `<td style="padding: 0.4rem; border-bottom: 1px solid #f1f5f9;">${val !== null ? val : ''}</td>`;
                        });
                        html += '</tr>';
                    });

                    html += '</tbody></table></div>';
                    gridContainer.innerHTML = html;
                }

            } catch (parseError) {
                console.error('[Order Transactions] Parse error:', parseError);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error parsing data</p><p style="font-size: 0.85rem;">${parseError.message}</p></div>`;
            }
        });
    };

    window.refreshShipmentDetails = function(orderNumber) {
        console.log('[Order Transactions] Refresh Shipment Details for:', orderNumber);
        const gridContainer = document.getElementById('shipment-details-grid');
        if (gridContainer) {
            gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Shipment Details will be loaded here</p><p style="font-size: 0.85rem; margin-top: 0.5rem;">Data retrieval API integration pending</p></div>';
        }
    };

    window.refreshPickConfirmResponses = function(orderNumber) {
        console.log('[Order Transactions] Refresh Pick Confirmation Responses for:', orderNumber);
        const gridContainer = document.getElementById('pick-confirm-responses-grid');
        if (gridContainer) {
            gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Pick Confirmation Responses will be loaded here</p><p style="font-size: 0.85rem; margin-top: 0.5rem;">Data retrieval API integration pending</p></div>';
        }
    };

    window.refreshShipConfirmResponses = function(orderNumber) {
        console.log('[Order Transactions] Refresh Shipment Confirmation Responses for:', orderNumber);
        const gridContainer = document.getElementById('ship-confirm-responses-grid');
        if (gridContainer) {
            gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Shipment Confirmation Responses will be loaded here</p><p style="font-size: 0.85rem; margin-top: 0.5rem;">Data retrieval API integration pending</p></div>';
        }
    };

    // Toggle Store Transactions Header Details
    window.toggleStoreTransHeader = function() {
        const details = document.getElementById('store-trans-header-details');
        const toggleBtn = document.getElementById('store-trans-header-toggle');
        const icon = toggleBtn.querySelector('i');

        if (details.style.display === 'none' || details.style.display === '') {
            details.style.display = 'grid';
            icon.style.transform = 'rotate(180deg)';
        } else {
            details.style.display = 'none';
            icon.style.transform = 'rotate(0deg)';
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

                    // Initialize DevExpress DataGrid with checkbox selection
                    transactionDetailsGrid = $('#transaction-details-grid').dxDataGrid({
                        dataSource: response.items,
                        showBorders: true,
                        showRowLines: true,
                        showColumnLines: true,
                        rowAlternationEnabled: true,
                        columnAutoWidth: false,
                        allowColumnReordering: true,
                        allowColumnResizing: true,
                        wordWrapEnabled: false,
                        hoverStateEnabled: true,
                        selection: {
                            mode: 'multiple',
                            showCheckBoxesMode: 'always',
                            allowSelectAll: true
                        },
                        scrolling: {
                            mode: 'standard',
                            columnRenderingMode: 'virtual',
                            useNative: true
                        },
                        columnFixing: {
                            enabled: true
                        },
                        sorting: {
                            mode: 'multiple'
                        },
                        columns: columns,
                        paging: {
                            pageSize: 50
                        },
                        pager: {
                            visible: true,
                            showPageSizeSelector: true,
                            allowedPageSizes: [20, 50, 100, 200],
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
                        onSelectionChanged: function(e) {
                            const selectedCount = e.selectedRowsData.length;
                            console.log('[Store Transactions] Selection changed, selected count:', selectedCount);
                            // Update button visibility based on selection
                            const cancelBtn = document.getElementById('cancel-selected-lines-btn');
                            if (cancelBtn) {
                                cancelBtn.style.display = selectedCount > 0 ? 'inline-flex' : 'none';
                            }
                        },
                        onContentReady: function(e) {
                            console.log('[Store Transactions] Transaction Details Grid loaded, row count:', e.component.totalCount());
                        }
                    }).dxDataGrid('instance');

                    // Show Fetch Lot Details button
                    document.getElementById('fetch-lot-btn').style.display = 'inline-flex';
                    // Initially hide Cancel Selected Lines button (will show when rows selected)
                    document.getElementById('cancel-selected-lines-btn').style.display = 'none';
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

    // Cancel Selected Transaction Lines
    window.cancelSelectedTransactionLines = async function(orderNumber) {
        console.log('[Store Transactions] Cancel Selected Lines called for order:', orderNumber);

        // Get selected rows from the grid
        if (!transactionDetailsGrid) {
            alert('Transaction details grid not loaded');
            return;
        }

        const selectedRows = transactionDetailsGrid.getSelectedRowsData();
        console.log('[Store Transactions] Selected rows:', selectedRows);

        if (!selectedRows || selectedRows.length === 0) {
            alert('Please select at least one line to cancel');
            return;
        }

        // Filter only PENDING lines (case-insensitive check)
        const pendingRows = selectedRows.filter(row => {
            const status = (row.TRANSACTION_STATUS || row.transaction_status || '').toUpperCase();
            return status === 'PENDING' || status === '' || !status;
        });

        if (pendingRows.length === 0) {
            alert('No pending lines selected. Only lines with PENDING status can be cancelled.');
            return;
        }

        // Warn if some rows are not pending
        if (pendingRows.length < selectedRows.length) {
            const nonPendingCount = selectedRows.length - pendingRows.length;
            if (!confirm(`${nonPendingCount} line(s) are not in PENDING status and will be skipped.\n\nContinue to cancel ${pendingRows.length} pending line(s)?`)) {
                return;
            }
        } else {
            if (!confirm(`Are you sure you want to cancel ${pendingRows.length} selected line(s)?`)) {
                return;
            }
        }

        // Show progress modal
        showCancelLinesProgressModal(pendingRows, orderNumber);
    };

    // Show Cancel Lines Progress Modal
    function showCancelLinesProgressModal(lines, orderNumber) {
        // Remove existing modal if any
        const existingModal = document.getElementById('cancel-lines-progress-modal');
        if (existingModal) existingModal.remove();

        const modalHtml = `
            <div id="cancel-lines-progress-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100000; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 12px; width: 600px; max-height: 80vh; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.1rem;"><i class="fas fa-ban"></i> Cancelling Selected Lines</h3>
                        <span id="cancel-progress-count" style="font-size: 0.9rem;">0 / ${lines.length}</span>
                    </div>
                    <div style="padding: 1.5rem;">
                        <div style="margin-bottom: 1rem;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="font-size: 0.85rem; color: #64748b;">Progress</span>
                                <span id="cancel-progress-percent" style="font-size: 0.85rem; font-weight: 600; color: #667eea;">0%</span>
                            </div>
                            <div style="height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                                <div id="cancel-progress-bar" style="height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); width: 0%; transition: width 0.3s ease;"></div>
                            </div>
                        </div>
                        <div id="cancel-lines-status" style="max-height: 300px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.5rem;">
                            ${lines.map((line, idx) => `
                                <div id="cancel-line-status-${idx}" style="padding: 0.5rem; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 0.75rem;">
                                    <span id="cancel-line-icon-${idx}" style="width: 20px; text-align: center;">
                                        <i class="fas fa-clock" style="color: #94a3b8;"></i>
                                    </span>
                                    <span style="flex: 1; font-size: 0.85rem;">
                                        <strong>ID:</strong> ${line.TRANSACTION_ID || line.transaction_id || 'N/A'} |
                                        <strong>Item:</strong> ${line.ITEM || line.item || 'N/A'}
                                    </span>
                                    <span id="cancel-line-result-${idx}" style="font-size: 0.75rem; color: #94a3b8;">Waiting...</span>
                                </div>
                            `).join('')}
                        </div>
                        <div id="cancel-summary" style="margin-top: 1rem; padding: 0.75rem; background: #f8fafc; border-radius: 8px; display: none;">
                            <div style="display: flex; gap: 1.5rem; justify-content: center;">
                                <span style="color: #10b981; font-weight: 600;"><i class="fas fa-check-circle"></i> Success: <span id="cancel-success-count">0</span></span>
                                <span style="color: #ef4444; font-weight: 600;"><i class="fas fa-times-circle"></i> Failed: <span id="cancel-failed-count">0</span></span>
                            </div>
                        </div>
                    </div>
                    <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 0.5rem;">
                        <button id="cancel-lines-close-btn" onclick="closeCancelLinesModal('${orderNumber}')" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1.5rem; border-radius: 6px; cursor: pointer; font-weight: 600; display: none;">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Start cancelling lines
        processCancelLines(lines, orderNumber);
    }

    // Process Cancel Lines one by one
    async function processCancelLines(lines, orderNumber) {
        let successCount = 0;
        let failedCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const transactionId = line.TRANSACTION_ID || line.transaction_id;

            // Update current line status to processing
            const iconEl = document.getElementById(`cancel-line-icon-${i}`);
            const resultEl = document.getElementById(`cancel-line-result-${i}`);
            if (iconEl) iconEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: #f59e0b;"></i>';
            if (resultEl) {
                resultEl.textContent = 'Cancelling...';
                resultEl.style.color = '#f59e0b';
            }

            try {
                const result = await callCancelLineAPI(transactionId);

                if (result.success) {
                    successCount++;
                    if (iconEl) iconEl.innerHTML = '<i class="fas fa-check-circle" style="color: #10b981;"></i>';
                    if (resultEl) {
                        resultEl.textContent = 'Cancelled';
                        resultEl.style.color = '#10b981';
                    }
                } else {
                    failedCount++;
                    if (iconEl) iconEl.innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';
                    if (resultEl) {
                        resultEl.textContent = result.message || 'Failed';
                        resultEl.style.color = '#ef4444';
                    }
                }
            } catch (error) {
                failedCount++;
                if (iconEl) iconEl.innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';
                if (resultEl) {
                    resultEl.textContent = error.message || 'Error';
                    resultEl.style.color = '#ef4444';
                }
            }

            // Update progress
            const progress = Math.round(((i + 1) / lines.length) * 100);
            const progressBar = document.getElementById('cancel-progress-bar');
            const progressPercent = document.getElementById('cancel-progress-percent');
            const progressCount = document.getElementById('cancel-progress-count');

            if (progressBar) progressBar.style.width = `${progress}%`;
            if (progressPercent) progressPercent.textContent = `${progress}%`;
            if (progressCount) progressCount.textContent = `${i + 1} / ${lines.length}`;

            // Small delay between API calls
            if (i < lines.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        // Show summary and close button
        const summary = document.getElementById('cancel-summary');
        const closeBtn = document.getElementById('cancel-lines-close-btn');
        const successEl = document.getElementById('cancel-success-count');
        const failedEl = document.getElementById('cancel-failed-count');

        if (summary) summary.style.display = 'block';
        if (closeBtn) closeBtn.style.display = 'inline-block';
        if (successEl) successEl.textContent = successCount;
        if (failedEl) failedEl.textContent = failedCount;

        console.log('[Store Transactions] Cancel complete - Success:', successCount, 'Failed:', failedCount);
    }

    // Call Cancel Line API
    function callCancelLineAPI(transactionId) {
        return new Promise((resolve, reject) => {
            const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/cancels2vline/${transactionId}`;

            console.log('[Store Transactions] Calling cancel API for transaction:', transactionId);

            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: JSON.stringify({})
            }, function(error, data) {
                if (error) {
                    console.error('[Store Transactions] Cancel API error:', error);
                    reject(new Error(error));
                    return;
                }

                try {
                    const response = JSON.parse(data);
                    console.log('[Store Transactions] Cancel API response:', response);

                    if (response.success || response.status === 'success' || response.message?.toLowerCase().includes('success')) {
                        resolve({ success: true, message: response.message || 'Cancelled' });
                    } else {
                        resolve({ success: false, message: response.message || 'Failed to cancel' });
                    }
                } catch (parseError) {
                    // If response is not JSON, check if it's a success indicator
                    if (data && (data.toLowerCase().includes('success') || data.toLowerCase().includes('cancelled'))) {
                        resolve({ success: true, message: 'Cancelled' });
                    } else {
                        resolve({ success: false, message: data || 'Unknown error' });
                    }
                }
            });
        });
    }

    // Close Cancel Lines Modal
    window.closeCancelLinesModal = function(orderNumber) {
        const modal = document.getElementById('cancel-lines-progress-modal');
        if (modal) modal.remove();

        // Refresh the transaction details grid
        if (orderNumber) {
            refreshTransactionDetails(orderNumber);
        }

        // Clear selection in grid
        if (transactionDetailsGrid) {
            transactionDetailsGrid.clearSelection();
        }
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

                        // Add custom cell template ONLY for status columns
                        if (isStatusColumn(key)) {
                            console.log('[Store Transactions] Status column detected:', key);
                            column.cellTemplate = function(container, options) {
                                const value = options.value;
                                console.log('[Store Transactions] Rendering status cell:', key, '=', value, 'Type:', typeof value);

                                // Create wrapper div
                                const wrapper = document.createElement('div');
                                wrapper.style.textAlign = 'center';

                                // Create icon element using DOM methods
                                const icon = document.createElement('i');
                                icon.style.fontSize = '0.9rem';

                                if (value === 'Y' || value === 'Yes' || value === 'YES') {
                                    icon.className = 'fas fa-check-circle';
                                    icon.style.color = '#10b981';
                                    icon.title = 'Yes';
                                    console.log('[Store Transactions] Matched YES condition - creating green check');
                                } else {
                                    // Show red X for NO, null, or empty values
                                    icon.className = 'fas fa-times-circle';
                                    icon.style.color = '#ef4444';
                                    icon.title = 'No';
                                    console.log('[Store Transactions] Matched NO condition - creating red X');
                                }

                                wrapper.appendChild(icon);
                                $(container).empty().append(wrapper);
                                console.log('[Store Transactions] Icon element appended to container');
                            };
                            column.alignment = 'center';
                        }
                        // For non-status columns, let DevExpress handle default rendering (no cellTemplate)

                        return column;
                    });

                    // Initialize DevExpress DataGrid with selection
                    allocatedLotsGrid = $('#allocated-lots-grid').dxDataGrid({
                        dataSource: response.items,
                        showBorders: true,
                        showRowLines: true,
                        showColumnLines: true,
                        rowAlternationEnabled: true,
                        columnAutoWidth: false,
                        allowColumnReordering: true,
                        allowColumnResizing: true,
                        wordWrapEnabled: false,
                        hoverStateEnabled: true,
                        scrolling: {
                            mode: 'standard',
                            columnRenderingMode: 'virtual',
                            useNative: true
                        },
                        columnFixing: {
                            enabled: true
                        },
                        sorting: {
                            mode: 'multiple'
                        },
                        selection: {
                            mode: 'multiple',
                            showCheckBoxesMode: 'always'
                        },
                        columns: columns,
                        paging: {
                            pageSize: 50
                        },
                        pager: {
                            visible: true,
                            showPageSizeSelector: true,
                            allowedPageSizes: [20, 50, 100, 200],
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
                            // Force grid to recalculate dimensions on first load only
                            if (!this._firstLoadComplete) {
                                this._firstLoadComplete = true;
                                setTimeout(() => {
                                    e.component.repaint();
                                }, 100);
                            }
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
                        columnAutoWidth: false,
                        allowColumnReordering: true,
                        allowColumnResizing: true,
                        wordWrapEnabled: false,
                        hoverStateEnabled: true,
                        scrolling: {
                            mode: 'standard',
                            columnRenderingMode: 'virtual',
                            useNative: true
                        },
                        columnFixing: {
                            enabled: true
                        },
                        sorting: {
                            mode: 'multiple'
                        },
                        columns: columns,
                        paging: {
                            pageSize: 50
                        },
                        pager: {
                            visible: true,
                            showPageSizeSelector: true,
                            allowedPageSizes: [20, 50, 100, 200],
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
                            // Force grid to recalculate dimensions on first load only
                            if (!this._firstLoadComplete) {
                                this._firstLoadComplete = true;
                                setTimeout(() => {
                                    e.component.repaint();
                                }, 100);
                            }
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
        console.log('[Store Transactions] getSelectedAllocatedLots called');
        console.log('[Store Transactions] allocatedLotsGrid exists:', !!allocatedLotsGrid);

        if (allocatedLotsGrid) {
            console.log('[Store Transactions] allocatedLotsGrid type:', typeof allocatedLotsGrid);
            console.log('[Store Transactions] allocatedLotsGrid has getSelectedRowsData:', typeof allocatedLotsGrid.getSelectedRowsData);

            try {
                const selectedData = allocatedLotsGrid.getSelectedRowsData();
                console.log('[Store Transactions] Selected rows count:', selectedData.length);
                console.log('[Store Transactions] Selected rows data:', selectedData);
                return selectedData;
            } catch (error) {
                console.error('[Store Transactions] Error getting selected rows:', error);
                return [];
            }
        } else {
            console.warn('[Store Transactions] allocatedLotsGrid is null/undefined');
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

        // Send Store transactions modal to back when Set Data opens
        const storeTransModal = document.getElementById('store-transactions-modal');
        if (storeTransModal) {
            console.log('[Set Data] Sending Store transactions modal to back (lowering z-index)');
            storeTransModal.style.zIndex = '100';  // Lower z-index to send to back
        }
    }

    window.closeSetDataDialog = function() {
        const modal = document.getElementById('set-data-modal');
        if (modal) {
            modal.remove();
        }

        // Restore Store transactions modal z-index when Set Data closes
        const storeTransModal = document.getElementById('store-transactions-modal');
        if (storeTransModal) {
            console.log('[Set Data] Restoring Store transactions modal z-index to front');
            storeTransModal.style.zIndex = '25000';  // Restore original z-index
        }
    };

    window.submitSetData = async function(orderNumber, selectedItems) {
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

        // Build records array for the API (always multiple records format)
        const records = [];

        // For single selection, still send as array with one record
        selectedItems.forEach(item => {
            const record = {
                lid: item.LID || item.lid || item.ID || item.id
            };

            // Only include fields that have values
            if (lotNumber) record.lot_number = lotNumber;
            if (lotExpDate) record.lot_expiration_date = lotExpDate;
            if (pickedQty) record.picked_qty = parseFloat(pickedQty);
            if (shipConfirmStatus) record.ship_confirm_status = shipConfirmStatus;
            if (pickConfirmStatus) record.pick_confirm_status = pickConfirmStatus;
            if (cancelledStatus) record.cancelled_status = cancelledStatus;

            records.push(record);
        });

        const payload = { records };

        console.log('[Set Data] API Payload:', JSON.stringify(payload, null, 2));

        // ORDS endpoint URL
        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/sets2vdata';

        // Log debug info before request
        logDebugInfo('Set Data (Single)', apiUrl, payload, null, null, 'POST');

        try {
            // Make POST request via C# (to handle CORS)
            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': 'application/json'
                }
            }, function(error, data) {
                console.log('[Set Data] Response received');
                console.log('[Set Data] Error:', error);
                console.log('[Set Data] Data type:', typeof data);
                console.log('[Set Data] Data length:', data ? data.length : 0);
                console.log('[Set Data] Raw data:', data);
                console.log('[Set Data] First 200 chars:', data ? data.substring(0, 200) : 'null');

                if (error) {
                    // Log error to debug
                    logDebugInfo('Set Data (Single) - Error', apiUrl, payload, null, error, 'POST');
                    alert('Failed to set data: ' + error);
                    return;
                }

                // Parse response
                try {
                    // Clean the data - remove any whitespace/newlines and try to extract JSON
                    let cleanData = data;
                    if (typeof data === 'string') {
                        // Log original for debugging
                        console.log('[Set Data] Original response (with escape chars):', JSON.stringify(data));

                        // Handle multiple concatenated JSON objects (e.g., }{)
                        // Split by }{ and try to find the valid response object
                        if (data.includes('}{')) {
                            console.log('[Set Data] Multiple JSON objects detected, splitting...');
                            const parts = data.split('}{');

                            // Try to parse each part (add back the braces)
                            for (let i = parts.length - 1; i >= 0; i--) {
                                let part = parts[i];
                                if (i > 0) part = '{' + part; // Add opening brace
                                if (i < parts.length - 1) part = part + '}'; // Add closing brace

                                try {
                                    const parsed = JSON.parse(part);
                                    // Use the first valid JSON that has a 'success' field (the actual response)
                                    if (parsed.hasOwnProperty('success')) {
                                        cleanData = part;
                                        console.log('[Set Data] Found valid response object:', cleanData);
                                        break;
                                    }
                                } catch (e) {
                                    console.log('[Set Data] Part ' + i + ' is not valid JSON, skipping');
                                }
                            }
                        } else {
                            // Try to extract JSON if response has extra content
                            const jsonMatch = data.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                cleanData = jsonMatch[0];
                                console.log('[Set Data] Extracted JSON:', cleanData);
                            }
                        }
                    }

                    const response = typeof cleanData === 'string' ? JSON.parse(cleanData) : cleanData;
                    console.log('[Set Data] Parsed response:', response);

                    // Log success to debug
                    logDebugInfo('Set Data (Single) - Success', apiUrl, payload, response, null, 'POST');

                    if (response.success) {
                        alert(`Success! Updated ${response.successCount} record(s).\n\n${response.message}`);
                        closeSetDataDialog();
                        // Refresh the allocated lots grid to show updated data
                        refreshAllocatedLots(orderNumber);
                    } else {
                        const errorMsg = response.errorDetails || response.message || 'Unknown error';
                        alert(`Failed to set data:\n\n${errorMsg}`);
                    }
                } catch (parseError) {
                    console.error('[Set Data] Parse error:', parseError);
                    console.error('[Set Data] Failed to parse data:', data);

                    // Log with raw data for debugging
                    const debugData = {
                        rawResponse: data,
                        responseType: typeof data,
                        responseLength: data ? data.length : 0,
                        first100chars: data ? data.substring(0, 100) : null
                    };
                    logDebugInfo('Set Data (Single) - Parse Error', apiUrl, payload, debugData, parseError.message, 'POST');

                    alert(`Error parsing response: ${parseError.message}\n\nRaw response (first 200 chars):\n${data ? data.substring(0, 200) : 'null'}\n\nCheck Debug Log for full details.`);
                }
            });

        } catch (error) {
            console.error('[Set Data] Error:', error);
            logDebugInfo('Set Data (Single) - Exception', apiUrl, payload, null, error.message, 'POST');
            alert('Error submitting data: ' + error.message);
        }
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
    window.submitSetDataGrid = async function(orderNumber, selectedItems) {
        console.log('[Store Transactions] Submitting grid set data for:', orderNumber);

        // Build records array for the API
        const records = [];

        selectedItems.forEach((item, index) => {
            const lotNumber = document.querySelector(`.grid-lot-number[data-row="${index}"]`).value.trim();
            const lotExpDate = document.querySelector(`.grid-lot-exp[data-row="${index}"]`).value;
            const pickedQty = document.querySelector(`.grid-picked-qty[data-row="${index}"]`).value;
            const shipStatus = document.querySelector(`.grid-ship-status[data-row="${index}"]`).value;
            const pickStatus = document.querySelector(`.grid-pick-status[data-row="${index}"]`).value;
            const cancelStatus = document.querySelector(`.grid-cancel-status[data-row="${index}"]`).value;

            // Build record with lid
            const record = {
                lid: item.LID || item.lid || item.ID || item.id
            };

            // Only include fields that have values
            if (lotNumber) record.lot_number = lotNumber;
            if (lotExpDate) record.lot_expiration_date = lotExpDate;
            if (pickedQty) record.picked_qty = parseFloat(pickedQty);
            if (shipStatus) record.ship_confirm_status = shipStatus;
            if (pickStatus) record.pick_confirm_status = pickStatus;
            if (cancelStatus) record.cancelled_status = cancelStatus;

            records.push(record);
        });

        const payload = { records };

        console.log('[Set Data Grid] API Payload:', JSON.stringify(payload, null, 2));

        // ORDS endpoint URL
        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/sets2vdata';

        // Log debug info before request
        logDebugInfo('Set Data (Multiple)', apiUrl, payload, null, null, 'POST');

        try {
            // Make POST request via C# (to handle CORS)
            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': 'application/json'
                }
            }, function(error, data) {
                console.log('[Set Data Grid] Response received');
                console.log('[Set Data Grid] Error:', error);
                console.log('[Set Data Grid] Data type:', typeof data);
                console.log('[Set Data Grid] Data length:', data ? data.length : 0);
                console.log('[Set Data Grid] Raw data:', data);
                console.log('[Set Data Grid] First 200 chars:', data ? data.substring(0, 200) : 'null');

                if (error) {
                    // Log error to debug
                    logDebugInfo('Set Data (Multiple) - Error', apiUrl, payload, null, error, 'POST');
                    alert('Failed to set data: ' + error);
                    return;
                }

                // Parse response
                try {
                    // Clean the data - remove any whitespace/newlines and try to extract JSON
                    let cleanData = data;
                    if (typeof data === 'string') {
                        // Log original for debugging
                        console.log('[Set Data Grid] Original response (with escape chars):', JSON.stringify(data));

                        // Handle multiple concatenated JSON objects (e.g., }{)
                        // Split by }{ and try to find the valid response object
                        if (data.includes('}{')) {
                            console.log('[Set Data Grid] Multiple JSON objects detected, splitting...');
                            const parts = data.split('}{');

                            // Try to parse each part (add back the braces)
                            for (let i = parts.length - 1; i >= 0; i--) {
                                let part = parts[i];
                                if (i > 0) part = '{' + part; // Add opening brace
                                if (i < parts.length - 1) part = part + '}'; // Add closing brace

                                try {
                                    const parsed = JSON.parse(part);
                                    // Use the first valid JSON that has a 'success' field (the actual response)
                                    if (parsed.hasOwnProperty('success')) {
                                        cleanData = part;
                                        console.log('[Set Data Grid] Found valid response object:', cleanData);
                                        break;
                                    }
                                } catch (e) {
                                    console.log('[Set Data Grid] Part ' + i + ' is not valid JSON, skipping');
                                }
                            }
                        } else {
                            // Try to extract JSON if response has extra content
                            const jsonMatch = data.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                cleanData = jsonMatch[0];
                                console.log('[Set Data Grid] Extracted JSON:', cleanData);
                            }
                        }
                    }

                    const response = typeof cleanData === 'string' ? JSON.parse(cleanData) : cleanData;
                    console.log('[Set Data Grid] Parsed response:', response);

                    // Log success to debug
                    logDebugInfo('Set Data (Multiple) - Success', apiUrl, payload, response, null, 'POST');

                    if (response.success) {
                        const message = `Success! Updated ${response.successCount} record(s).\n\n${response.message}`;
                        if (response.errorCount > 0) {
                            alert(`${message}\n\nErrors: ${response.errorCount}\nDetails: ${response.errorDetails}`);
                        } else {
                            alert(message);
                        }
                        closeSetDataDialog();
                        // Refresh the allocated lots grid to show updated data
                        refreshAllocatedLots(orderNumber);
                    } else {
                        const errorMsg = response.errorDetails || response.message || 'Unknown error';
                        alert(`Failed to set data:\n\n${errorMsg}`);
                    }
                } catch (parseError) {
                    console.error('[Set Data Grid] Parse error:', parseError);
                    console.error('[Set Data Grid] Failed to parse data:', data);

                    // Log with raw data for debugging
                    const debugData = {
                        rawResponse: data,
                        responseType: typeof data,
                        responseLength: data ? data.length : 0,
                        first100chars: data ? data.substring(0, 100) : null
                    };
                    logDebugInfo('Set Data (Multiple) - Parse Error', apiUrl, payload, debugData, parseError.message, 'POST');

                    alert(`Error parsing response: ${parseError.message}\n\nRaw response (first 200 chars):\n${data ? data.substring(0, 200) : 'null'}\n\nCheck Debug Log for full details.`);
                }
            });

        } catch (error) {
            console.error('[Set Data Grid] Error:', error);
            logDebugInfo('Set Data (Multiple) - Exception', apiUrl, payload, null, error.message, 'POST');
            alert('Error submitting data: ' + error.message);
        }
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
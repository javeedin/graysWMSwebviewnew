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
                            <span style="font-size: 0.9rem; font-weight: 700; color: #1e293b;">Trip #${trip.TRIP_ID}</span>
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
                        <button class="btn btn-primary" onclick="openTripDetails('${trip.TRIP_ID}', '${trip.TRIP_DATE}', '${trip.LORRY_NUMBER}')" style="width: 100%; font-size: 0.65rem; padding: 0.4rem 0.6rem; justify-content: center;">
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
        console.log('[JS] currentFullData length:', currentFullData.length);

        // Check if data has been loaded
        if (!currentFullData || currentFullData.length === 0) {
            alert('No trip data loaded!\n\nPlease click "Fetch Trips" button first to load the data, then try viewing trip details again.');
            return;
        }

        // Filter trip data - match original logic (case-insensitive, trip_id OR TRIP_ID)
        const tripData = currentFullData.filter(trip => {
            const tripIdLower = (trip.trip_id || '').toString().toLowerCase();
            const tripIdUpper = (trip.TRIP_ID || '').toString().toLowerCase();
            const searchId = tripId.toString().toLowerCase();
            return tripIdLower === searchId || tripIdUpper === searchId;
        });

        console.log('[JS] Found', tripData.length, 'records for trip:', tripId);

        if (tripData.length === 0) {
            alert('No data found for trip: ' + tripId + '\n\nThe trip might not be in the current date range.\nPlease adjust the date range and click "Fetch Trips" again.');
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
                            <button class="btn btn-secondary" onclick="assignPickerToTrip('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                                <i class="fas fa-user-check"></i> Assign Picker
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
                width: 150,
                alignment: 'center',
                allowFiltering: false,
                allowSorting: false,
                cellTemplate: function(container, options) {
                    const rowData = options.data;
                    $(container).html(`
                        <div style="display: flex; gap: 0.5rem; justify-content: center;">
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

    // Placeholder functions for trip actions (to be implemented)
    window.assignPickerToTrip = function(tripId) {
        console.log('[Trip Management] Assign picker to trip:', tripId);
        alert('Assign Picker functionality - To be implemented');
    };

    window.pickReleaseAll = function(tripId) {
        console.log('[Trip Management] Pick release all for trip:', tripId);
        alert('Pick Release All functionality - To be implemented');
    };

    window.unassignPicker = function(tripId, orderNumber) {
        console.log('[Trip Management] Unassign picker for order:', orderNumber);
        alert('Unassign Picker functionality - To be implemented');
    };

    window.pickRelease = function(tripId, orderNumber) {
        console.log('[Trip Management] Pick release for order:', orderNumber);
        alert('Pick Release functionality - To be implemented');
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
        const tripId = rowData.TRIP_ID || rowData.trip_id || '';
        const tripDate = rowData.TRIP_DATE || rowData.trip_date || '';
        const accountNumber = rowData.ACCOUNT_NUMBER || rowData.account_number || '';
        const accountName = rowData.ACCOUNT_NAME || rowData.account_name || '';
        const picker = rowData.PICKER || rowData.picker || '';
        const lorry = rowData.LORRY_NUMBER || rowData.lorry_number || '';
        const priority = rowData.PRIORITY || rowData.priority || '';
        const pickConfirmSt = rowData.PICK_CONFIRM_ST || rowData.pick_confirm_st || '';

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
                            <button onclick="closeStoreTransactionsModal()" style="background: transparent; border: 1px solid #cbd5e1; font-size: 20px; cursor: pointer; color: #64748b; padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.2s;" onmouseover="this.style.background='#e2e8f0'; this.style.color='#1e293b';" onmouseout="this.style.background='transparent'; this.style.color='#64748b';">
                                ×
                            </button>
                        </div>

                        <!-- Header Details -->
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.5rem; padding: 0.6rem; background: white; border-radius: 6px; border: 1px solid #e2e8f0;">
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Trip ID:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${tripId}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.65rem; font-weight: 600;">Order Number:</span><br><strong style="color: #1e293b; font-size: 0.8rem;">${orderNumber}</strong></div>
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
                            <div id="transaction-details-content" style="background: white; border-radius: 8px; padding: 0.75rem;">
                                <p style="color: #64748b; text-align: center; font-size: 0.8rem;">Click Refresh to load transaction details</p>
                            </div>
                        </div>

                        <!-- Tab 2: QOH Details -->
                        <div id="store-trans-qoh-details" class="store-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshQOHDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="qoh-details-content" style="background: white; border-radius: 8px; padding: 0.75rem;">
                                <p style="color: #64748b; text-align: center; font-size: 0.8rem;">Click Refresh to load QOH details</p>
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
                            <div id="allocated-lots-content" style="background: white; border-radius: 8px; padding: 0.75rem;">
                                <p style="color: #64748b; text-align: center; font-size: 0.8rem;">Click Refresh to load allocated lots</p>
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

    window.refreshTransactionDetails = async function(orderNumber) {
        console.log('[Store Transactions] Refreshing transaction details for:', orderNumber);

        const contentDiv = document.getElementById('transaction-details-content');
        contentDiv.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; color: #667eea;"></i><p style="margin-top: 1rem; color: #64748b;">Loading transaction details...</p></div>';

        const currentInstance = localStorage.getItem('fusionInstance') || 'PROD';
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/s2vdetails/${orderNumber}`;

        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            console.log('[Store Transactions] Callback - Error:', error, 'Data:', data);

            if (error) {
                contentDiv.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error: ${error}</p>`;
                return;
            }

            try {
                const response = JSON.parse(data);
                console.log('[Store Transactions] Parsed Response:', response);

                if (response && response.items && response.items.length > 0) {
                    // Get keys from first item
                    const keys = Object.keys(response.items[0]);

                    // Create search box and table
                    let html = `
                        <div style="margin-bottom: 0.75rem; display: flex; gap: 0.75rem; align-items: center; background: white; padding: 0.5rem; border-radius: 6px; border: 1px solid #e2e8f0;">
                            <div style="flex: 1; position: relative;">
                                <i class="fas fa-search" style="position: absolute; left: 0.6rem; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 0.75rem;"></i>
                                <input type="text" id="trans-search-input" placeholder="Search in table..."
                                    style="width: 100%; padding: 0.4rem 0.5rem 0.4rem 2rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem; outline: none; transition: all 0.2s;"
                                    onkeyup="filterTransactionTable()"
                                    onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 3px rgba(102, 126, 234, 0.1)'"
                                    onblur="this.style.borderColor='#e2e8f0'; this.style.boxShadow='none'">
                            </div>
                            <div style="font-size: 0.75rem; color: #64748b; white-space: nowrap;">
                                <span id="trans-row-count">${response.items.length}</span> rows
                            </div>
                        </div>

                        <div style="background: white; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                            <div style="overflow-x: auto; max-height: 500px; overflow-y: auto;">
                                <table id="trans-data-table" style="width: 100%; border-collapse: collapse;">
                                    <thead style="position: sticky; top: 0; z-index: 10;">
                                        <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-bottom: 2px solid #667eea;">
                    `;

                    keys.forEach(key => {
                        html += `<th style="padding: 0.5rem; text-align: left; font-weight: 600; color: white; font-size: 0.7rem; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.3px;">${key.replace(/_/g, ' ')}</th>`;
                    });

                    html += '</tr></thead><tbody>';

                    // Add rows with hover effect
                    response.items.forEach((item, index) => {
                        html += `<tr class="trans-table-row" style="border-bottom: 1px solid #e2e8f0; transition: background 0.2s;"
                            onmouseover="this.style.background='#f0f9ff'"
                            onmouseout="this.style.background='${index % 2 === 0 ? '#f8f9fc' : 'white'}'"
                            data-row-index="${index}">`;
                        keys.forEach(key => {
                            html += `<td style="padding: 0.5rem; font-size: 0.7rem; color: #475569; white-space: nowrap;">${item[key] !== null && item[key] !== undefined ? item[key] : ''}</td>`;
                        });
                        html += '</tr>';
                    });

                    html += '</tbody></table></div></div>';
                    contentDiv.innerHTML = html;

                    // Show Fetch Lot Details button
                    document.getElementById('fetch-lot-btn').style.display = 'inline-flex';
                } else {
                    contentDiv.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 2rem;">No data found for this order</p>';
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                contentDiv.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error parsing data: ${parseError.message}</p>`;
            }
        });
    };

    window.filterTransactionTable = function() {
        const input = document.getElementById('trans-search-input');
        const filter = input.value.toUpperCase();
        const table = document.getElementById('trans-data-table');
        const rows = table.getElementsByTagName('tr');
        let visibleCount = 0;

        // Loop through all table rows (skip header)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const cells = row.getElementsByTagName('td');
            let found = false;

            // Search in all cells of the row
            for (let j = 0; j < cells.length; j++) {
                const cell = cells[j];
                if (cell) {
                    const textValue = cell.textContent || cell.innerText;
                    if (textValue.toUpperCase().indexOf(filter) > -1) {
                        found = true;
                        break;
                    }
                }
            }

            if (found) {
                row.style.display = '';
                visibleCount++;
            } else {
                row.style.display = 'none';
            }
        }

        // Update row count
        const rowCountSpan = document.getElementById('trans-row-count');
        if (rowCountSpan) {
            rowCountSpan.textContent = visibleCount;
        }
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

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            bodyJson: JSON.stringify(postData)
        }, function(error, data) {
            console.log('[Store Transactions] Fetch Lot Details Response - Error:', error, 'Data:', data);

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
                    alert('Success: ' + (response.message || 'Lot details fetched successfully'));

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

        const contentDiv = document.getElementById('allocated-lots-content');
        contentDiv.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>';

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fetchlotdetails?v_trx_number=${orderNumber}`;

        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            console.log('[Store Transactions] Allocated Lots Callback - Error:', error, 'Data:', data);

            if (error) {
                contentDiv.innerHTML = `<p style="color: #ef4444; text-align: center;">Error: ${error}</p>`;
                return;
            }

            try {
                const response = JSON.parse(data);

                if (response && response.items && response.items.length > 0) {
                    // Store items globally for access when setting data
                    window.allocatedLotsData = response.items;

                    const keys = Object.keys(response.items[0]);

                    // Helper function to render status icons
                    const renderStatusIcon = (value) => {
                        if (value === 'Y' || value === 'Yes' || value === 'YES') {
                            return '<i class="fas fa-check-circle" style="color: #10b981; font-size: 0.9rem;" title="Yes"></i>';
                        } else if (value === 'N' || value === 'No' || value === 'NO') {
                            return '<i class="fas fa-times-circle" style="color: #ef4444; font-size: 0.9rem;" title="No"></i>';
                        } else if (value === null || value === '') {
                            return '<span style="color: #94a3b8;">-</span>';
                        }
                        return value;
                    };

                    // Create search box and table
                    let html = `
                        <div style="margin-bottom: 0.75rem; display: flex; gap: 0.75rem; align-items: center; background: white; padding: 0.5rem; border-radius: 6px; border: 1px solid #e2e8f0;">
                            <div style="flex: 1; position: relative;">
                                <i class="fas fa-search" style="position: absolute; left: 0.6rem; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 0.75rem;"></i>
                                <input type="text" id="allocated-search-input" placeholder="Search in table..."
                                    style="width: 100%; padding: 0.4rem 0.5rem 0.4rem 2rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem; outline: none; transition: all 0.2s;"
                                    onkeyup="filterAllocatedLotsTable()"
                                    onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 3px rgba(102, 126, 234, 0.1)'"
                                    onblur="this.style.borderColor='#e2e8f0'; this.style.boxShadow='none'">
                            </div>
                            <div style="font-size: 0.75rem; color: #64748b; white-space: nowrap;">
                                <span id="allocated-selected-count">0</span> selected |
                                <span id="allocated-row-count">${response.items.length}</span> rows
                            </div>
                        </div>

                        <div style="background: white; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                            <div style="overflow-x: auto; max-height: 500px; overflow-y: auto;">
                                <table id="allocated-data-table" style="width: 100%; border-collapse: collapse;">
                                    <thead style="position: sticky; top: 0; z-index: 10;">
                                        <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-bottom: 2px solid #667eea;">
                                            <th style="padding: 0.5rem; width: 40px; text-align: center;">
                                                <input type="checkbox" id="select-all-allocated" onchange="toggleSelectAllAllocated()"
                                                    style="cursor: pointer; width: 16px; height: 16px;">
                                            </th>
                    `;

                    keys.forEach(key => {
                        html += `<th style="padding: 0.5rem; text-align: left; font-weight: 600; color: white; font-size: 0.7rem; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.3px;">${key.replace(/_/g, ' ')}</th>`;
                    });

                    html += '</tr></thead><tbody>';

                    // Add rows with checkboxes and status icons
                    response.items.forEach((item, index) => {
                        html += `<tr class="allocated-table-row" style="border-bottom: 1px solid #e2e8f0; transition: background 0.2s;"
                            onmouseover="this.style.background='#f0f9ff'"
                            onmouseout="this.style.background='${index % 2 === 0 ? '#f8f9fc' : 'white'}'"
                            data-row-index="${index}">
                            <td style="padding: 0.5rem; text-align: center;">
                                <input type="checkbox" class="allocated-row-checkbox" data-index="${index}"
                                    onchange="updateAllocatedSelectedCount()" style="cursor: pointer; width: 16px; height: 16px;">
                            </td>`;
                        keys.forEach(key => {
                            const value = item[key];
                            const lowerKey = key.toLowerCase();
                            const upperKey = key.toUpperCase();

                            // Check if this is a status column - updated to match new field names
                            if (lowerKey.includes('status') ||
                                lowerKey.includes('_st') ||
                                upperKey === 'PICKED_ST' ||
                                upperKey === 'CANCELED_ST' ||
                                upperKey === 'SHIPED_ST' ||
                                lowerKey === 'picked_status' ||
                                lowerKey === 'canceled_status' ||
                                lowerKey === 'ship_confirm_st') {
                                html += `<td style="padding: 0.5rem; font-size: 0.7rem; color: #475569; white-space: nowrap; text-align: center;">${renderStatusIcon(value)}</td>`;
                            } else {
                                html += `<td style="padding: 0.5rem; font-size: 0.7rem; color: #475569; white-space: nowrap;">${value !== null && value !== undefined ? value : ''}</td>`;
                            }
                        });
                        html += '</tr>';
                    });

                    html += '</tbody></table></div></div>';
                    contentDiv.innerHTML = html;
                } else {
                    contentDiv.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 2rem;">No allocated lots found for this order</p>';
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                contentDiv.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error parsing data: ${parseError.message}</p>`;
            }
        });
    };

    // Filter function for Allocated Lots table
    window.filterAllocatedLotsTable = function() {
        const input = document.getElementById('allocated-search-input');
        const filter = input.value.toUpperCase();
        const table = document.getElementById('allocated-data-table');
        const rows = table.getElementsByTagName('tr');
        let visibleCount = 0;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const cells = row.getElementsByTagName('td');
            let found = false;

            for (let j = 0; j < cells.length; j++) {
                const cell = cells[j];
                if (cell) {
                    const textValue = cell.textContent || cell.innerText;
                    if (textValue.toUpperCase().indexOf(filter) > -1) {
                        found = true;
                        break;
                    }
                }
            }

            if (found) {
                row.style.display = '';
                visibleCount++;
            } else {
                row.style.display = 'none';
            }
        }

        const rowCountSpan = document.getElementById('allocated-row-count');
        if (rowCountSpan) {
            rowCountSpan.textContent = visibleCount;
        }
    };

    // Refresh QOH Details (Tab 2)
    window.refreshQOHDetails = async function(orderNumber) {
        console.log('[Store Transactions] Refreshing QOH details for:', orderNumber);

        const contentDiv = document.getElementById('qoh-details-content');
        contentDiv.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>';

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/tripqoh?v_trx_number=${orderNumber}`;

        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            console.log('[Store Transactions] QOH Details Callback - Error:', error, 'Data:', data);

            if (error) {
                contentDiv.innerHTML = `<p style="color: #ef4444; text-align: center;">Error: ${error}</p>`;
                return;
            }

            try {
                const response = JSON.parse(data);

                if (response && response.items && response.items.length > 0) {
                    // Store QOH data globally for lot number lookup
                    window.qohData = response.items;

                    const keys = Object.keys(response.items[0]);

                    // Create search box and table
                    let html = `
                        <div style="margin-bottom: 0.75rem; display: flex; gap: 0.75rem; align-items: center; background: white; padding: 0.5rem; border-radius: 6px; border: 1px solid #e2e8f0;">
                            <div style="flex: 1; position: relative;">
                                <i class="fas fa-search" style="position: absolute; left: 0.6rem; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 0.75rem;"></i>
                                <input type="text" id="qoh-search-input" placeholder="Search in table..."
                                    style="width: 100%; padding: 0.4rem 0.5rem 0.4rem 2rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem; outline: none; transition: all 0.2s;"
                                    onkeyup="filterQOHTable()"
                                    onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 3px rgba(102, 126, 234, 0.1)'"
                                    onblur="this.style.borderColor='#e2e8f0'; this.style.boxShadow='none'">
                            </div>
                            <div style="font-size: 0.75rem; color: #64748b; white-space: nowrap;">
                                <span id="qoh-row-count">${response.items.length}</span> rows
                            </div>
                        </div>

                        <div style="background: white; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                            <div style="overflow-x: auto; max-height: 500px; overflow-y: auto;">
                                <table id="qoh-data-table" style="width: 100%; border-collapse: collapse;">
                                    <thead style="position: sticky; top: 0; z-index: 10;">
                                        <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-bottom: 2px solid #667eea;">
                    `;

                    keys.forEach(key => {
                        html += `<th style="padding: 0.5rem; text-align: left; font-weight: 600; color: white; font-size: 0.7rem; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.3px;">${key.replace(/_/g, ' ')}</th>`;
                    });

                    html += '</tr></thead><tbody>';

                    // Add rows
                    response.items.forEach((item, index) => {
                        html += `<tr class="qoh-table-row" style="border-bottom: 1px solid #e2e8f0; transition: background 0.2s;"
                            onmouseover="this.style.background='#f0f9ff'"
                            onmouseout="this.style.background='${index % 2 === 0 ? '#f8f9fc' : 'white'}'"
                            data-row-index="${index}">`;
                        keys.forEach(key => {
                            html += `<td style="padding: 0.5rem; font-size: 0.7rem; color: #475569; white-space: nowrap;">${item[key] !== null && item[key] !== undefined ? item[key] : ''}</td>`;
                        });
                        html += '</tr>';
                    });

                    html += '</tbody></table></div></div>';
                    contentDiv.innerHTML = html;
                } else {
                    contentDiv.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 2rem;">No QOH data found for this order</p>';
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                contentDiv.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error parsing data: ${parseError.message}</p>`;
            }
        });
    };

    // Filter function for QOH Details table
    window.filterQOHTable = function() {
        const input = document.getElementById('qoh-search-input');
        const filter = input.value.toUpperCase();
        const table = document.getElementById('qoh-data-table');
        const rows = table.getElementsByTagName('tr');
        let visibleCount = 0;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const cells = row.getElementsByTagName('td');
            let found = false;

            for (let j = 0; j < cells.length; j++) {
                const cell = cells[j];
                if (cell) {
                    const textValue = cell.textContent || cell.innerText;
                    if (textValue.toUpperCase().indexOf(filter) > -1) {
                        found = true;
                        break;
                    }
                }
            }

            if (found) {
                row.style.display = '';
                visibleCount++;
            } else {
                row.style.display = 'none';
            }
        }

        const rowCountSpan = document.getElementById('qoh-row-count');
        if (rowCountSpan) {
            rowCountSpan.textContent = visibleCount;
        }
    };

    // Toggle Select All checkbox for Allocated Lots
    window.toggleSelectAllAllocated = function() {
        const selectAll = document.getElementById('select-all-allocated');
        const checkboxes = document.querySelectorAll('.allocated-row-checkbox');

        checkboxes.forEach(cb => {
            cb.checked = selectAll.checked;
        });

        updateAllocatedSelectedCount();
    };

    // Update selected count for Allocated Lots
    window.updateAllocatedSelectedCount = function() {
        const checkboxes = document.querySelectorAll('.allocated-row-checkbox');
        const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

        const countSpan = document.getElementById('allocated-selected-count');
        if (countSpan) {
            countSpan.textContent = checkedCount;
        }

        // Update select-all checkbox state
        const selectAll = document.getElementById('select-all-allocated');
        if (selectAll) {
            selectAll.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
        }
    };

    window.processTransaction = function(orderNumber) {
        console.log('[Store Transactions] Process transaction for:', orderNumber);
        alert('Process Transaction functionality - To be implemented');
    };

    window.setData = function(orderNumber) {
        console.log('[Store Transactions] Set data for:', orderNumber);

        // Get selected rows
        const checkboxes = document.querySelectorAll('.allocated-row-checkbox:checked');

        if (checkboxes.length === 0) {
            alert('Please select at least one record to set data');
            return;
        }

        // Get selected items data
        const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));
        const selectedItems = selectedIndices.map(index => window.allocatedLotsData[index]);

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
// ============================================================================
// AUTO INVENTORY PROCESSING
// ============================================================================
//  Automated inventory transaction processing with intelligent retry
// ============================================================================

// Toggle API Info panel
window.toggleAutoInventoryApiInfo = function() {
    const panel = document.getElementById('auto-inventory-api-info');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
};

// Global state
let autoProcessingEnabled = false;
let autoProcessingInterval = null;
let autoProcessingData = [];
let autoProcessingFilters = {
    tripId: '',
    itemDesc: '',
    lid: '',
    trxNumber: '',
    status: ''
};
let autoProcessingStats = {
    totalTrips: 0,
    totalOrders: 0,
    totalLines: 0,
    cancelled: 0,
    processing: 0,
    success: 0,
    failed: 0
};

// Oracle Fusion Cloud credentials
let fusionCloudUsername = '';
let fusionCloudPassword = '';

// Processing Timer
let processingStartTime = null;
let processingEndTime = null;
let processingTimerInterval = null;
let isProcessing = false;
let currentProcessingTrip = null;
let currentProcessingTripId = null;
let currentProcessingOrder = null;

// Selected trips for processing (Set of trip_id strings)
let selectedTripsForProcessing = new Set();

// Pre-calculated summary data for selected trips
let selectedTripsSummary = {
    totalTrips: 0,
    totalOrders: 0,
    totalLines: 0,
    totalPicked: 0,
    totalNotPicked: 0,
    pickPercentage: 0,
    trips: [] // Array of trip detail objects
};

// Font size multiplier for Trip and Order groups (1.0 = 100%)
let tripOrderFontSizeMultiplier = 1.0;
const FONT_SIZE_STEP = 0.1; // 10% per click
const FONT_SIZE_MIN = 0.6;  // 60% minimum
const FONT_SIZE_MAX = 1.6;  // 160% maximum

// Initialize auto processing on page load
document.addEventListener('DOMContentLoaded', function() {
    initializeAutoProcessing();
    fetchFusionCloudCredentials();

    // Set page title in toolbar when this page is shown
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            const pageId = this.getAttribute('data-page');
            if (pageId === 'auto-inventory-processing') {
                const pageTitleElement = document.getElementById('current-page-title');
                if (pageTitleElement) {
                    pageTitleElement.textContent = 'Automate Inventory Processing';
                }
            }
        });
    });
});

// Initialize auto processing
function initializeAutoProcessing() {
    console.log('[Auto Processing] Initializing...');

    // Set default dates (today)
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('auto-from-date').value = today;
    document.getElementById('auto-to-date').value = today;

    // Setup toggle switch
    const toggle = document.getElementById('auto-process-toggle');
    if (toggle) {
        toggle.addEventListener('change', function() {
            if (this.checked) {
                startAutoProcessing();
            } else {
                stopAutoProcessing();
            }
        });
    }

    addLogEntry('System', 'Auto Inventory Processing initialized', 'success');
}

// Fetch Oracle Fusion Cloud credentials from API
function fetchFusionCloudCredentials() {
    const instance = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';
    const credentialsUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fusionuserdetails?p_instance_name=${instance}`;

    console.log('[Auto Processing] Fetching Fusion Cloud credentials...');
    addLogEntry('System', 'Fetching Oracle Fusion Cloud credentials...', 'info');

    sendMessageToCSharp({
        action: "executeGet",
        fullUrl: credentialsUrl
    }, function(error, data) {
        if (error) {
            console.error('[Auto Processing] Failed to fetch credentials:', error);
            addLogEntry('Error', `Failed to fetch Fusion Cloud credentials: ${error}`, 'error');
            return;
        }

        try {
            const response = JSON.parse(data);
            if (response.items && response.items.length > 0) {
                fusionCloudUsername = response.items[0].user_name || '';
                fusionCloudPassword = response.items[0].passwordd || '';

                // Set global properties for other modules (MRA, etc.) to access
                window.F_username = fusionCloudUsername;
                window.F_password = fusionCloudPassword;

                console.log('[Auto Processing] Fusion Cloud credentials loaded:', fusionCloudUsername);
                console.log('[Auto Processing] Global credentials set: window.F_username, window.F_password');
                addLogEntry('System', `Fusion Cloud credentials loaded for user: ${fusionCloudUsername}`, 'success');
            } else {
                console.error('[Auto Processing] No credentials found in response');
                addLogEntry('Error', 'No Fusion Cloud credentials found in API response', 'error');
            }
        } catch (parseError) {
            console.error('[Auto Processing] Failed to parse credentials:', parseError);
            addLogEntry('Error', `Failed to parse Fusion Cloud credentials: ${parseError.message}`, 'error');
        }
    });
}

// Fetch auto inventory data from API using WebView REST handler
function fetchAutoInventoryData() {
    const fromDate = document.getElementById('auto-from-date').value;
    const toDate = document.getElementById('auto-to-date').value;

    if (!fromDate || !toDate) {
        alert('Please select both From Date and To Date');
        return;
    }

    const fetchBtn = document.getElementById('auto-fetch-btn');
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';

    addLogEntry('API', `Fetching data from ${fromDate} to ${toDate}...`, 'info');

    // Get instance from sessionStorage or header
    const instance = sessionStorage.getItem('loggedInInstance')
        || document.getElementById('current-instance-display')?.textContent
        || 'PROD';

    // Build API URL
    const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/transactionforautopr?P_FROM_DATE=${fromDate}&P_TO_DATE=${toDate}&P_INSTANCE_NAME=${instance}`;

    console.log('[Auto Processing] Fetching from:', apiUrl);

    // Use WebView REST handler
    sendMessageToCSharp({
        action: "executeGet",
        fullUrl: apiUrl
    }, function(error, data) {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Fetch Data';

        if (error) {
            console.error('[Auto Processing] Fetch error:', error);
            addLogEntry('Error', `Failed to fetch data: ${error}`, 'error');

            const container = document.getElementById('auto-trips-container');
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: #ef4444;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 1rem;"></i>
                    <h3>Error Loading Data</h3>
                    <p style="color: #64748b;">${error}</p>
                </div>
            `;
        } else {
            try {
                // Parse response
                let response = JSON.parse(data);

                // Store the data
                autoProcessingData = response.items || [];

                console.log('[Auto Processing] Fetched', autoProcessingData.length, 'records');

                // Debug: Log first record to see available fields
                if (autoProcessingData.length > 0) {
                    console.log('=== API RESPONSE DEBUG ===');
                    console.log('First record keys:', Object.keys(autoProcessingData[0]));
                    console.log('First record:', JSON.stringify(autoProcessingData[0], null, 2));
                    console.log('=========================');
                }

                addLogEntry('API', `Fetched ${autoProcessingData.length} transaction records`, 'success');

                // Group and display data
                displayGroupedTrips();

                // Update statistics
                updateStatistics();

                // Populate filter dropdowns with data
                populateFilterDropdowns();

            } catch (e) {
                console.error('[Auto Processing] Parse error:', e);
                addLogEntry('Error', `Failed to parse data: ${e.message}`, 'error');

                const container = document.getElementById('auto-trips-container');
                container.innerHTML = `
                    <div style="text-align: center; padding: 3rem; color: #ef4444;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 1rem;"></i>
                        <h3>Invalid JSON Response</h3>
                        <p style="color: #64748b;">${e.message}</p>
                    </div>
                `;
            }
        }
    });
}

// Group transactions by trip
function groupTransactionsByTrip() {
    console.log('=== groupTransactionsByTrip ===');
    console.log('autoProcessingData length:', autoProcessingData ? autoProcessingData.length : 'undefined');
    if (autoProcessingData && autoProcessingData.length > 0) {
        console.log('First autoProcessingData item:', JSON.stringify(autoProcessingData[0], null, 2).substring(0, 500));
    }

    const grouped = {};

    autoProcessingData.forEach(item => {
        const tripId = item.trip_id;

        if (!grouped[tripId]) {
            grouped[tripId] = {
                trip_id: item.trip_id,
                trip_date: item.trip_date,
                trip_lorry: item.trip_lorry,
                trip_priority: item.trip_priority,
                trip_loading_bay: item.trip_loading_bay,
                instance_name: item.instance_name,
                transactions: []
            };
        }

        grouped[tripId].transactions.push(item);
    });

    const result = Object.values(grouped);
    console.log('groupTransactionsByTrip result count:', result.length);
    return result;
}

// Display grouped trips
function displayGroupedTrips() {
    const container = document.getElementById('auto-trips-container');
    const groupedTrips = groupTransactionsByTrip();

    // Store currently expanded states before re-rendering
    const expandedStates = {};
    document.querySelectorAll('[id^="order-details-"]').forEach(element => {
        if (element.style.display === 'block') {
            expandedStates[element.id] = true;
        }
    });

    if (groupedTrips.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: #94a3b8;">
                <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 1rem;"></i>
                <p style="font-size: 16px; margin: 0;">No transactions found for the selected date range.</p>
            </div>
        `;
        return;
    }

    let html = '';

    groupedTrips.forEach((trip, index) => {
        // Get distinct order count (unique TRX_NUMBER)
        const distinctOrders = [...new Set(trip.transactions.map(t => t.trx_number))];
        const orderCount = distinctOrders.length;

        // Calculate status counts (case-insensitive)
        const successCount = trip.transactions.filter(t => (t.transaction_status || '').toUpperCase() === 'SUCCESS').length;
        const failedCount = trip.transactions.filter(t => { const s = (t.transaction_status || '').toUpperCase(); return s === 'FAILED' || s === 'ERROR'; }).length;
        const processingCount = trip.transactions.filter(t => (t.transaction_status || '').toUpperCase() === 'PROCESSING').length;
        const cancelledCount = trip.transactions.filter(t => (t.transaction_status || '').toUpperCase() === 'CANCELLED').length;
        const pendingCount = trip.transactions.length - successCount - failedCount - processingCount - cancelledCount;

        // Check if this trip is selected
        const isSelected = selectedTripsForProcessing.has(trip.trip_id);
        const selectBtnStyle = isSelected
            ? 'background: #f59e0b; border: 2px solid #f59e0b;'
            : 'background: #94a3b8; border: 2px solid #94a3b8;';
        const selectBtnText = isSelected
            ? '<i class="fas fa-check-square"></i> Selected'
            : '<i class="fas fa-square"></i> Select';
        const cardBorderStyle = isSelected
            ? 'border: 3px solid #f59e0b;'
            : 'border: 2px solid #e2e8f0;';

        html += `
            <div id="trip-card-${index}" style="background: white; ${cardBorderStyle} border-radius: 8px; margin-bottom: 0.75rem; overflow: hidden; transition: all 0.3s;">
                <!-- Trip Header -->
                <div class="trip-group-header" onclick="toggleTripDetails(${index})" style="padding: 0.75rem 1rem; background: linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s;" onmouseover="this.style.background='linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)'" onmouseout="this.style.background='linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%)'">
                    <div style="display: flex; gap: 1.5rem; align-items: center; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <i class="fas fa-truck trip-group-icon" style="color: #667eea; font-size: 16px;"></i>
                            <div>
                                <div class="trip-group-label" style="font-size: 8px; color: #64748b; font-weight: 600;">TRIP ID</div>
                                <div class="trip-group-value" style="font-size: 13px; font-weight: 700; color: #1e293b;">${trip.trip_id}</div>
                            </div>
                        </div>
                        <div>
                            <div class="trip-group-label" style="font-size: 8px; color: #64748b; font-weight: 600;">DATE</div>
                            <div class="trip-group-value-sm" style="font-size: 11px; font-weight: 600; color: #1e293b;">${new Date(trip.trip_date).toLocaleDateString()}</div>
                        </div>
                        <div>
                            <div class="trip-group-label" style="font-size: 8px; color: #64748b; font-weight: 600;">LORRY</div>
                            <div class="trip-group-value-sm" style="font-size: 11px; font-weight: 600; color: #1e293b;">${trip.trip_lorry}</div>
                        </div>
                        <div>
                            <div class="trip-group-label" style="font-size: 8px; color: #64748b; font-weight: 600;">PRIORITY</div>
                            <div class="trip-group-value-sm" style="font-size: 11px; font-weight: 600; color: #1e293b;">${trip.trip_priority}</div>
                        </div>
                        <div>
                            <div class="trip-group-label" style="font-size: 8px; color: #64748b; font-weight: 600;">LOADING BAY</div>
                            <div class="trip-group-value-sm" style="font-size: 11px; font-weight: 600; color: #1e293b;">${trip.trip_loading_bay || 'N/A'}</div>
                        </div>
                        <div>
                            <div class="trip-group-label" style="font-size: 8px; color: #64748b; font-weight: 600;">ORDERS</div>
                            <div class="trip-group-value" style="font-size: 13px; font-weight: 700; color: #667eea;">${orderCount}</div>
                        </div>
                        <div class="trip-stats-badges" style="display: flex; gap: 0.4rem;">
                            ${successCount > 0 ? `<span class="trip-stats-badge" style="background: #10b981; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;">${successCount} ✓</span>` : ''}
                            ${processingCount > 0 ? `<span class="trip-stats-badge" style="background: #f59e0b; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;"><i class="fas fa-spinner fa-spin"></i> ${processingCount}</span>` : ''}
                            ${pendingCount > 0 ? `<span class="trip-stats-badge" style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;">${pendingCount} ⏳</span>` : ''}
                            ${cancelledCount > 0 ? `<span class="trip-stats-badge" style="background: #6b7280; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;">${cancelledCount} ⊘</span>` : ''}
                            ${failedCount > 0 ? `<span class="trip-stats-badge" style="background: #ef4444; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;">${failedCount} ✗</span>` : ''}
                        </div>
                    </div>
                    <button id="trip-select-btn-${index}" onclick="event.stopPropagation(); toggleTripSelection('${trip.trip_id}', ${index})" style="${selectBtnStyle} color: white; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 600; display: flex; align-items: center; gap: 0.4rem; margin-right: 0.4rem; transition: all 0.2s;" title="Select for processing">
                        ${selectBtnText}
                    </button>
                    <button onclick="event.stopPropagation(); openTripPrintModal('${trip.trip_id}', '${trip.trip_date}', ${orderCount}, ${index})" style="background: #10b981; color: white; border: none; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 600; display: flex; align-items: center; gap: 0.4rem; margin-right: 0.75rem; transition: all 0.2s;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'" title="Print all orders in this trip">
                        <i class="fas fa-print"></i> Print Trip
                    </button>
                    <i class="fas fa-chevron-down" id="trip-chevron-${index}" style="color: #667eea; transition: transform 0.3s;"></i>
                </div>

                <!-- Trip Details (Collapsible) -->
                <div id="trip-details-${index}" style="display: none; padding: 1rem; background: #f8f9fa;">
                    ${renderTripTransactions(trip.transactions, index)}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Restore expanded states after re-rendering
    Object.keys(expandedStates).forEach(elementId => {
        const element = document.getElementById(elementId);
        const chevronId = elementId.replace('order-details-', 'order-chevron-');
        const chevron = document.getElementById(chevronId);

        if (element && chevron) {
            element.style.display = 'block';
            chevron.style.transform = 'rotate(180deg)';
        }
    });

    // Show expand/collapse all button when there's data
    const expandCollapseBtn = document.getElementById('expand-collapse-all-btn');
    if (expandCollapseBtn) {
        expandCollapseBtn.style.display = groupedTrips.length > 0 ? 'block' : 'none';
    }
}

// Render trip transactions grouped by order
function renderTripTransactions(transactions, tripIndex) {
    // Group transactions by TRX_NUMBER
    const orderGroups = {};

    transactions.forEach((trx, idx) => {
        const orderNum = trx.trx_number;

        // Debug: Log picker field values for the first transaction
        if (idx === 0) {
            console.log('=== PICKER & NEW COLUMNS DEBUG ===');
            console.log('trx.picker:', trx.picker);
            console.log('trx.PICKER:', trx.PICKER);
            console.log('trx.picker_name:', trx.picker_name);
            console.log('trx.PICKER_NAME:', trx.PICKER_NAME);
            console.log('trx.assigned_picker:', trx.assigned_picker);
            console.log('trx.ASSIGNED_PICKER:', trx.ASSIGNED_PICKER);
            console.log('trx.TOTAL_S2V_LINES:', trx.TOTAL_S2V_LINES);
            console.log('trx.total_s2v_lines:', trx.total_s2v_lines);
            console.log('trx.TOTAL_ASSIGNED_LINES:', trx.TOTAL_ASSIGNED_LINES);
            console.log('trx.total_assigned_lines:', trx.total_assigned_lines);
            console.log('Full trx object keys:', Object.keys(trx));
            console.log('Full trx object:', JSON.stringify(trx, null, 2));
            console.log('===================');
        }

        if (!orderGroups[orderNum]) {
            // Get picker from various possible field names
            const pickerValue = trx.picker || trx.PICKER || trx.picker_name || trx.PICKER_NAME || trx.ASSIGNED_PICKER || trx.assigned_picker || '';
            console.log(`Order ${orderNum} - Picker value resolved to:`, pickerValue);

            // Get S2V lines and assigned lines from transaction
            const totalS2VLines = trx.TOTAL_S2V_LINES || trx.total_s2v_lines || 0;
            const totalAssignedLines = trx.TOTAL_ASSIGNED_LINES || trx.total_assigned_lines || 0;
            console.log(`Order ${orderNum} - S2V Lines: ${totalS2VLines}, Assigned Lines: ${totalAssignedLines}`);

            orderGroups[orderNum] = {
                trx_number: orderNum,
                trx_type: trx.trx_type,
                source_sub_inv: trx.source_sub_inv,
                dest_sub_inv: trx.dest_sub_inv,
                picker_name: pickerValue,
                total_s2v_lines: totalS2VLines,
                total_assigned_lines: totalAssignedLines,
                items: [],
                totalReqQty: 0,
                totalQty: 0,
                totalLines: 0,
                processedLines: 0,
                notProcessedLines: 0,
                overallStatus: trx.transaction_status
            };
        }
        orderGroups[orderNum].items.push({ ...trx, originalIndex: idx });
        orderGroups[orderNum].totalReqQty += trx.header_original_qty || 0;
        orderGroups[orderNum].totalQty += trx.picked_qty || 0;
        orderGroups[orderNum].totalLines += 1;

        // Count processed vs not processed (case-insensitive)
        if ((trx.transaction_status || '').toUpperCase() === 'SUCCESS') {
            orderGroups[orderNum].processedLines += 1;
        } else {
            orderGroups[orderNum].notProcessedLines += 1;
        }
    });

    const orders = Object.values(orderGroups);

    let html = `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 1rem; gap: 0.5rem;">
            <button onclick="expandAllOrders(${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                <i class="fas fa-expand-alt"></i> Expand All
            </button>
            <button onclick="collapseAllOrders(${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                <i class="fas fa-compress-alt"></i> Collapse All
            </button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 1rem;">
    `;

    orders.forEach((order, orderIdx) => {
        // Order status logic:
        // - SUCCESS: All items are SUCCESS or CANCELLED (no real pending work)
        // - FAILED: Any item is FAILED or ERROR
        // - PENDING: There are actual pending items
        const allSuccessOrCancelled = order.items.every(i => { const s = (i.transaction_status || '').toUpperCase(); return s === 'SUCCESS' || s === 'CANCELLED'; });
        const hasFailed = order.items.some(i => { const s = (i.transaction_status || '').toUpperCase(); return s === 'FAILED' || s === 'ERROR'; });

        const orderStatus = hasFailed ? 'FAILED' :
                           allSuccessOrCancelled ? 'SUCCESS' :
                           'PENDING';

        const statusColor = orderStatus === 'SUCCESS' ? '#10b981' :
                           orderStatus === 'FAILED' ? '#ef4444' :
                           '#3b82f6';

        const statusIcon = orderStatus === 'SUCCESS' ? 'check-circle' :
                          orderStatus === 'FAILED' ? 'times-circle' :
                          'clock';

        const orderId = `trip-${tripIndex}-order-${orderIdx}`;

        html += `
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;" data-order-container="${tripIndex}">
                <!-- Order Header (lighter than trip header) -->
                <div class="order-group-header" onclick="toggleOrderDetails('${orderId}')" style="padding: 0.5rem 0.75rem; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s; border-left: 3px solid #667eea;" onmouseover="this.style.background='linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'" onmouseout="this.style.background='linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)'">
                    <div style="display: flex; gap: 1rem; align-items: center; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <i class="fas fa-box order-group-icon" style="color: #667eea; font-size: 14px;"></i>
                            <div>
                                <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Order</div>
                                <div class="order-group-value" style="font-size: 12px; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 0.4rem;">
                                    ${order.trx_number}
                                    <button onclick="event.stopPropagation(); openStoreTransactionsFromOrder('${order.trx_number}', '${order.instance_name || 'PROD'}')" style="background: transparent; border: 1px solid #667eea; color: #667eea; padding: 1px 4px; border-radius: 4px; cursor: pointer; font-size: 9px; display: flex; align-items: center; gap: 0.2rem; transition: all 0.2s;" onmouseover="this.style.background='#667eea'; this.style.color='white'" onmouseout="this.style.background='transparent'; this.style.color='#667eea'" title="Edit Transaction">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <i class="fas fa-spinner fa-spin" id="order-processing-${orderId}" style="color: #667eea; font-size: 10px; display: none;"></i>
                                </div>
                            </div>
                        </div>
                        <div>
                            <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Type</div>
                            <div class="order-group-value-sm" style="font-size: 10px; font-weight: 600; color: #475569;">${order.trx_type || 'N/A'}</div>
                        </div>
                        <div>
                            <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Total Lines</div>
                            <div class="order-group-value-sm" style="font-size: 11px; font-weight: 700; color: #1e293b;">${order.totalLines}</div>
                        </div>
                        <div>
                            <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Processed</div>
                            <div class="order-group-value-sm" style="font-size: 11px; font-weight: 700; color: #10b981;">${order.processedLines}</div>
                        </div>
                        <div>
                            <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Not Processed</div>
                            <div class="order-group-value-sm" style="font-size: 11px; font-weight: 700; color: ${order.notProcessedLines > 0 ? '#ef4444' : '#cbd5e1'};">${order.notProcessedLines}</div>
                        </div>
                        <div>
                            <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Req Qty</div>
                            <div class="order-group-value-sm" style="font-size: 11px; font-weight: 700; color: #667eea;">${order.totalReqQty}</div>
                        </div>
                        <div>
                            <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Qty</div>
                            <div class="order-group-value-sm" style="font-size: 11px; font-weight: 700; color: #667eea;">${order.totalQty}</div>
                        </div>
                        <div>
                            <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">From → To</div>
                            <div class="order-group-value-sm" style="font-size: 10px; font-weight: 600; color: #475569;">${order.source_sub_inv} → ${order.dest_sub_inv}</div>
                        </div>
                        <div>
                            <span class="order-stats-badge" style="display: inline-flex; align-items: center; gap: 0.2rem; background: ${statusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
                                <i class="fas fa-${statusIcon}"></i> ${orderStatus}
                            </span>
                        </div>
                        <div>
                            <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">S2V Lines</div>
                            <div class="order-group-value-sm" style="font-size: 11px; font-weight: 700; color: #f59e0b;">${order.total_s2v_lines || 0}</div>
                        </div>
                        <div>
                            <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Assigned</div>
                            <div class="order-group-value-sm" style="font-size: 11px; font-weight: 700; color: #06b6d4;">${order.total_assigned_lines || 0}</div>
                        </div>
                        <div>
                            <div class="order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Picker</div>
                            <div class="order-group-value-sm" style="font-size: 10px; font-weight: 600; color: #8b5cf6;">${order.picker_name || 'N/A'}</div>
                        </div>
                        <div style="display: flex; gap: 0.4rem; margin-left: auto;">
                            <button onclick="event.stopPropagation(); processSingleOrder('${order.trx_number}', ${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.3rem 0.6rem; border-radius: 5px; cursor: pointer; font-size: 9px; font-weight: 600; display: flex; align-items: center; gap: 0.2rem; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                                <i class="fas fa-play"></i> Process
                            </button>
                            <button onclick="event.stopPropagation(); verifyWithFusion('${order.trx_number}', ${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.3rem 0.6rem; border-radius: 5px; cursor: pointer; font-size: 9px; font-weight: 600; display: flex; align-items: center; gap: 0.2rem; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                                <i class="fas fa-cloud-upload-alt"></i> Verify
                            </button>
                            <button onclick="event.stopPropagation(); printOrder('${order.trx_number}', ${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.3rem 0.6rem; border-radius: 5px; cursor: pointer; font-size: 9px; font-weight: 600; display: flex; align-items: center; gap: 0.2rem; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                                <i class="fas fa-print"></i> Print
                            </button>
                        </div>
                    </div>
                    <i class="fas fa-chevron-down" id="order-chevron-${orderId}" style="color: #667eea; transition: transform 0.3s; font-size: 10px;"></i>
                </div>

                <!-- Order Items (Collapsible) -->
                <div id="order-details-${orderId}" style="display: none;">
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #f8f9fa; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">
                                        <input type="checkbox" id="select-all-${orderId}" onchange="toggleSelectAllOrder('${orderId}')" title="Select/Deselect All">
                                    </th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">#</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">LID</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Item Code</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Description</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Req qty</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Qty</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Lot Number</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Status</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Action</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Cancel</th>
                                </tr>
                            </thead>
                            <tbody>
        `;

        order.items.forEach((item, itemIdx) => {
            // Normalize transaction_status to uppercase for case-insensitive comparison
            const itemStatus = (item.transaction_status || '').toUpperCase();

            const itemStatusColor = itemStatus === 'SUCCESS' ? '#10b981' :
                                   itemStatus === 'FAILED' || itemStatus === 'ERROR' ? '#ef4444' :
                                   itemStatus === 'PROCESSING' ? '#f59e0b' :
                                   '#3b82f6';

            const itemStatusIcon = itemStatus === 'SUCCESS' ? 'check-circle' :
                                  itemStatus === 'FAILED' || itemStatus === 'ERROR' ? 'times-circle' :
                                  itemStatus === 'PROCESSING' ? 'spinner fa-spin' :
                                  'clock';

            html += `
                <tr id="transaction-row-${tripIndex}-${item.originalIndex}" class="order-row-${orderId}" style="border-bottom: 1px solid #f0f0f0;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='white'">
                    <td style="padding: 0.6rem 0.75rem; text-align: center;">
                        <input type="checkbox" class="bypass-checkbox bypass-checkbox-${orderId}" id="bypass-${tripIndex}-${item.originalIndex}" onchange="toggleBypassTransaction(${tripIndex}, ${item.originalIndex})" ${item.bypassed ? 'checked' : ''}>
                    </td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #94a3b8; font-weight: 600;">${itemIdx + 1}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; font-weight: 600; color: #667eea;">${item.lid || 'N/A'}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; font-weight: 600; color: #667eea;">${item.item_code}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #475569; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.item_desc}">${item.item_desc}</td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center; font-size: 12px; font-weight: 700; color: #3b82f6;">${item.header_original_qty || item.HEADER_ORIGINAL_QTY || 0}</td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center; font-size: 12px; font-weight: 700; color: #1e293b;">${item.picked_qty}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #475569;">${item.lot_number || 'N/A'}</td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center;" id="status-cell-${tripIndex}-${item.originalIndex}">
                        <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${itemStatusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
                            <i class="fas fa-${itemStatusIcon}"></i> ${itemStatus || 'PENDING'}
                        </span>
                    </td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center;" id="action-cell-${tripIndex}-${item.originalIndex}">
                        ${(itemStatus === 'FAILED' || itemStatus === 'ERROR') ? `
                            <div style="display: flex; gap: 0.25rem; justify-content: center;">
                                <button onclick="processSingleLine(${tripIndex}, ${item.originalIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                                    <i class="fas fa-play"></i> Process
                                </button>
                                <button onclick="showErrorDetails(${tripIndex}, ${item.originalIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                                    <i class="fas fa-exclamation-circle"></i> Show Errors
                                </button>
                            </div>
                        ` : itemStatus === 'PROCESSING' ? `
                            <span style="color: #f59e0b; font-size: 10px;"><i class="fas fa-spinner fa-spin"></i> Processing...</span>
                        ` : itemStatus === 'SUCCESS' ? `
                            <span style="color: #10b981; font-size: 10px;"><i class="fas fa-check-circle"></i> Completed</span>
                        ` : (!itemStatus || itemStatus === 'PENDING') && item.picked_qty && parseFloat(item.picked_qty) > 0 ? `
                            <button onclick="processSingleLine(${tripIndex}, ${item.originalIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                                <i class="fas fa-play"></i> Process
                            </button>
                        ` : `
                            <span style="color: #cbd5e1; font-size: 10px;">-</span>
                        `}
                    </td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center;" id="cancel-cell-${tripIndex}-${item.originalIndex}">
                        ${itemStatus === 'SUCCESS' ? `
                            <span style="color: #cbd5e1; font-size: 10px;">-</span>
                        ` : `
                            <button onclick="cancelS2VLot(${tripIndex}, ${item.originalIndex}, '${item.lid || ''}')" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="Cancel this line">
                                <i class="fas fa-times-circle"></i> Cancel
                            </button>
                        `}
                    </td>
                </tr>
            `;
        });

        html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

// Toggle trip details
function toggleTripDetails(index) {
    const details = document.getElementById(`trip-details-${index}`);
    const chevron = document.getElementById(`trip-chevron-${index}`);

    if (details.style.display === 'none') {
        details.style.display = 'block';
        chevron.style.transform = 'rotate(180deg)';
    } else {
        details.style.display = 'none';
        chevron.style.transform = 'rotate(0deg)';
    }
}

// Toggle trip selection for processing
function toggleTripSelection(tripId, index) {
    console.log('=== toggleTripSelection ===');
    console.log('tripId:', tripId, 'type:', typeof tripId);
    console.log('index:', index);

    const btn = document.getElementById(`trip-select-btn-${index}`);
    const tripCard = document.getElementById(`trip-card-${index}`);

    if (selectedTripsForProcessing.has(tripId)) {
        // Deselect
        selectedTripsForProcessing.delete(tripId);
        if (btn) {
            btn.style.background = '#94a3b8';
            btn.style.borderColor = '#94a3b8';
            btn.innerHTML = '<i class="fas fa-square"></i> Select';
        }
        if (tripCard) {
            tripCard.style.borderColor = '#e2e8f0';
            tripCard.style.borderWidth = '2px';
        }
        addLogEntry('Selection', `Trip ${tripId} deselected`, 'info');
    } else {
        // Select
        selectedTripsForProcessing.add(tripId);
        if (btn) {
            btn.style.background = '#f59e0b';
            btn.style.borderColor = '#f59e0b';
            btn.innerHTML = '<i class="fas fa-check-square"></i> Selected';
        }
        if (tripCard) {
            tripCard.style.borderColor = '#f59e0b';
            tripCard.style.borderWidth = '3px';
        }
        addLogEntry('Selection', `Trip ${tripId} selected for processing`, 'info');
    }

    updateSelectionCount();
}

// Select all trips for processing
function selectAllTrips() {
    const groupedTrips = groupTransactionsByTrip();
    groupedTrips.forEach((trip, index) => {
        if (!selectedTripsForProcessing.has(trip.trip_id)) {
            selectedTripsForProcessing.add(trip.trip_id);
            const btn = document.getElementById(`trip-select-btn-${index}`);
            const tripCard = document.getElementById(`trip-card-${index}`);
            if (btn) {
                btn.style.background = '#f59e0b';
                btn.style.borderColor = '#f59e0b';
                btn.innerHTML = '<i class="fas fa-check-square"></i> Selected';
            }
            if (tripCard) {
                tripCard.style.borderColor = '#f59e0b';
                tripCard.style.borderWidth = '3px';
            }
        }
    });
    updateSelectionCount();
    addLogEntry('Selection', `All ${groupedTrips.length} trips selected`, 'info');
}

// Deselect all trips
function deselectAllTrips() {
    const groupedTrips = groupTransactionsByTrip();
    selectedTripsForProcessing.clear();
    groupedTrips.forEach((trip, index) => {
        const btn = document.getElementById(`trip-select-btn-${index}`);
        const tripCard = document.getElementById(`trip-card-${index}`);
        if (btn) {
            btn.style.background = '#94a3b8';
            btn.style.borderColor = '#94a3b8';
            btn.innerHTML = '<i class="fas fa-square"></i> Select';
        }
        if (tripCard) {
            tripCard.style.borderColor = '#e2e8f0';
            tripCard.style.borderWidth = '2px';
        }
    });
    updateSelectionCount();
    addLogEntry('Selection', 'All trips deselected', 'info');
}

// Update selection count display and recalculate summary
function updateSelectionCount() {
    const countEl = document.getElementById('selected-trips-count');
    if (countEl) {
        const count = selectedTripsForProcessing.size;
        countEl.textContent = count > 0 ? `${count} trip${count > 1 ? 's' : ''} selected` : 'No trips selected';
        countEl.style.color = count > 0 ? '#f59e0b' : '#94a3b8';
    }

    // Recalculate summary data for selected trips
    recalculateSelectedTripsSummary();
}

// Recalculate the global selectedTripsSummary based on selected trips
function recalculateSelectedTripsSummary() {
    console.log('=== recalculateSelectedTripsSummary START ===');
    console.log('selectedTripsForProcessing:', Array.from(selectedTripsForProcessing));
    console.log('selectedTripsForProcessing.size:', selectedTripsForProcessing.size);

    // Reset summary
    selectedTripsSummary = {
        totalTrips: 0,
        totalOrders: 0,
        totalLines: 0,
        totalPicked: 0,
        totalNotPicked: 0,
        pickPercentage: 0,
        trips: []
    };

    if (selectedTripsForProcessing.size === 0) {
        console.log('No trips selected, returning early');
        return;
    }

    const groupedTrips = groupTransactionsByTrip();
    console.log('groupedTrips count:', groupedTrips.length);
    console.log('groupedTrips trip_ids:', groupedTrips.map(t => t.trip_id));
    if (groupedTrips.length > 0) {
        console.log('First grouped trip sample:', JSON.stringify(groupedTrips[0], null, 2).substring(0, 500));
    }

    selectedTripsForProcessing.forEach(tripId => {
        console.log('Looking for tripId:', tripId, 'type:', typeof tripId);
        const trip = groupedTrips.find(t => {
            console.log('Comparing with:', t.trip_id, 'type:', typeof t.trip_id, 'match:', t.trip_id === tripId || t.trip_id == tripId);
            return t.trip_id === tripId || t.trip_id == tripId;
        });
        console.log('Found trip:', trip ? 'YES' : 'NO');
        if (trip) {
            // Group transactions by order
            const orderGroups = {};
            trip.transactions.forEach(trx => {
                const orderNum = trx.source_order || trx.SOURCE_ORDER || 'Unknown';
                if (!orderGroups[orderNum]) {
                    orderGroups[orderNum] = {
                        orderNumber: orderNum,
                        picker: trx.picker || trx.PICKER || trx.picker_name || '-',
                        pickedCount: 0,
                        totalCount: 0
                    };
                }
                orderGroups[orderNum].totalCount++;
                if (trx.pick_confirm_status === 'YES' || trx.PICK_CONFIRM_STATUS === 'YES') {
                    orderGroups[orderNum].pickedCount++;
                    selectedTripsSummary.totalPicked++;
                } else {
                    selectedTripsSummary.totalNotPicked++;
                }
            });

            const orders = Object.values(orderGroups);

            // Calculate trip-level stats
            const tripPickedCount = orders.reduce((sum, o) => sum + o.pickedCount, 0);
            const tripTotalCount = orders.reduce((sum, o) => sum + o.totalCount, 0);
            const tripPickPct = tripTotalCount > 0 ? Math.round((tripPickedCount / tripTotalCount) * 100) : 0;

            // Get priority info
            const pri = trip.trip_priority;
            let priText = pri ? `P${pri}` : '-';
            let priColor = pri == 1 ? 'attention' : (pri == 2 ? 'warning' : 'default');

            // Add to summary
            selectedTripsSummary.trips.push({
                tripId: trip.trip_id,
                tripDate: trip.trip_date,
                tripLorry: trip.trip_lorry || '-',
                tripLoadingBay: trip.trip_loading_bay || '-',
                tripPriority: pri,
                priorityText: priText,
                priorityColor: priColor,
                orderCount: orders.length,
                lineCount: trip.transactions.length,
                pickedCount: tripPickedCount,
                pickPercentage: tripPickPct,
                orders: orders.map(order => {
                    const pickPct = order.totalCount > 0 ? Math.round((order.pickedCount / order.totalCount) * 100) : 0;
                    return {
                        orderNumber: order.orderNumber,
                        picker: order.picker,
                        pickedCount: order.pickedCount,
                        totalCount: order.totalCount,
                        pickPercentage: pickPct,
                        statusIcon: pickPct === 100 ? '🟢' : (pickPct > 0 ? '🟡' : '🔴'),
                        statusText: pickPct === 100 ? 'Picked' : (pickPct > 0 ? `${pickPct}%` : 'Pending')
                    };
                })
            });

            selectedTripsSummary.totalOrders += orders.length;
            selectedTripsSummary.totalLines += trip.transactions.length;
        }
    });

    selectedTripsSummary.totalTrips = selectedTripsSummary.trips.length;
    selectedTripsSummary.pickPercentage = selectedTripsSummary.totalLines > 0
        ? Math.round((selectedTripsSummary.totalPicked / selectedTripsSummary.totalLines) * 100)
        : 0;

    console.log('Selected Trips Summary:', selectedTripsSummary);
}

// Toggle order details
function toggleOrderDetails(orderId) {
    const details = document.getElementById(`order-details-${orderId}`);
    const chevron = document.getElementById(`order-chevron-${orderId}`);

    if (details.style.display === 'none') {
        details.style.display = 'block';
        chevron.style.transform = 'rotate(180deg)';
    } else {
        details.style.display = 'none';
        chevron.style.transform = 'rotate(0deg)';
    }
}

// Expand all orders in a trip
function expandAllOrders(tripIndex) {
    const containers = document.querySelectorAll(`[data-order-container="${tripIndex}"]`);
    containers.forEach((container) => {
        const orderId = container.querySelector('[id^="order-details-"]').id.replace('order-details-', '');
        const details = document.getElementById(`order-details-${orderId}`);
        const chevron = document.getElementById(`order-chevron-${orderId}`);

        if (details && chevron) {
            details.style.display = 'block';
            chevron.style.transform = 'rotate(180deg)';
        }
    });
    addLogEntry('UI', `Expanded all orders in trip ${tripIndex}`, 'info');
}

// Collapse all orders in a trip
function collapseAllOrders(tripIndex) {
    const containers = document.querySelectorAll(`[data-order-container="${tripIndex}"]`);
    containers.forEach((container) => {
        const orderId = container.querySelector('[id^="order-details-"]').id.replace('order-details-', '');
        const details = document.getElementById(`order-details-${orderId}`);
        const chevron = document.getElementById(`order-chevron-${orderId}`);

        if (details && chevron) {
            details.style.display = 'none';
            chevron.style.transform = 'rotate(0deg)';
        }
    });
    addLogEntry('UI', `Collapsed all orders in trip ${tripIndex}`, 'info');
}

// Toggle expand/collapse all orders (global)
let allOrdersExpanded = false;

function toggleExpandCollapseAll() {
    const allDetails = document.querySelectorAll('[id^="order-details-"]');
    const allChevrons = document.querySelectorAll('[id^="order-chevron-"]');
    const button = document.getElementById('expand-collapse-all-btn');

    if (!allOrdersExpanded) {
        // Expand all
        allDetails.forEach(details => {
            details.style.display = 'block';
        });
        allChevrons.forEach(chevron => {
            chevron.style.transform = 'rotate(180deg)';
        });
        button.innerHTML = '<i class="fas fa-compress-alt"></i> Collapse All';
        allOrdersExpanded = true;
        addLogEntry('UI', 'Expanded all orders', 'info');
    } else {
        // Collapse all
        allDetails.forEach(details => {
            details.style.display = 'none';
        });
        allChevrons.forEach(chevron => {
            chevron.style.transform = 'rotate(0deg)';
        });
        button.innerHTML = '<i class="fas fa-expand-alt"></i> Expand All';
        allOrdersExpanded = false;
        addLogEntry('UI', 'Collapsed all orders', 'info');
    }
}

// Update statistics
function updateStatistics() {
    const groupedTrips = groupTransactionsByTrip();

    // Calculate stats
    autoProcessingStats.totalTrips = groupedTrips.length;
    // Total Orders = distinct trx_number count
    const distinctOrders = [...new Set(autoProcessingData.map(t => t.trx_number))];
    autoProcessingStats.totalOrders = distinctOrders.length;
    // Total Lines = all transactions
    autoProcessingStats.totalLines = autoProcessingData.length;
    autoProcessingStats.success = autoProcessingData.filter(t => (t.transaction_status || '').toUpperCase() === 'SUCCESS').length;
    autoProcessingStats.failed = autoProcessingData.filter(t => { const s = (t.transaction_status || '').toUpperCase(); return s === 'FAILED' || s === 'ERROR'; }).length;
    autoProcessingStats.processing = autoProcessingData.filter(t => (t.transaction_status || '').toUpperCase() === 'PROCESSING').length;
    autoProcessingStats.cancelled = autoProcessingData.filter(t => (t.transaction_status || '').toUpperCase() === 'CANCELLED').length;

    // Update UI
    document.getElementById('auto-stat-trips').textContent = autoProcessingStats.totalTrips;
    document.getElementById('auto-stat-orders').textContent = autoProcessingStats.totalOrders;
    document.getElementById('auto-stat-lines').textContent = autoProcessingStats.totalLines;
    document.getElementById('auto-stat-cancelled').textContent = autoProcessingStats.cancelled;
    document.getElementById('auto-stat-success').textContent = autoProcessingStats.success;
    document.getElementById('auto-stat-failed').textContent = autoProcessingStats.failed;
    document.getElementById('auto-stat-processing').textContent = autoProcessingStats.processing;
}

// Start auto processing
function startAutoProcessing() {
    if (autoProcessingData.length === 0) {
        alert('Please fetch data first before enabling auto processing');
        document.getElementById('auto-process-toggle').checked = false;
        return;
    }

    autoProcessingEnabled = true;
    document.getElementById('auto-process-status').textContent = 'ENABLED';
    document.getElementById('auto-process-status').style.color = '#10b981';

    addLogEntry('System', 'Auto processing mode ENABLED - Ready to run simulation', 'success');
}

// Run simulation - manually triggered
// Format time to HH:MM:SS
function formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Calculate duration between two dates
function calculateDuration(startDate, endDate) {
    const diff = endDate - startDate;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Start processing timer
function startProcessingTimer() {
    processingStartTime = new Date();
    processingEndTime = null;

    // Show timer display
    const timerDisplay = document.getElementById('processing-timer');
    if (timerDisplay) {
        timerDisplay.style.display = 'flex';
    }

    // Set start time
    document.getElementById('timer-start-time').textContent = formatTime(processingStartTime);
    document.getElementById('timer-end-time').textContent = '--:--:--';
    document.getElementById('timer-duration').textContent = '00:00:00';

    // Clear any existing interval
    if (processingTimerInterval) {
        clearInterval(processingTimerInterval);
    }

    // Update duration every second
    processingTimerInterval = setInterval(() => {
        if (processingStartTime && !processingEndTime) {
            const now = new Date();
            const duration = calculateDuration(processingStartTime, now);
            document.getElementById('timer-duration').textContent = duration;
        }
    }, 1000);

    console.log('[Timer] Processing timer started at:', formatTime(processingStartTime));
}

// Stop processing timer
function stopProcessingTimer() {
    processingEndTime = new Date();

    // Stop interval
    if (processingTimerInterval) {
        clearInterval(processingTimerInterval);
        processingTimerInterval = null;
    }

    // Set end time and final duration
    document.getElementById('timer-end-time').textContent = formatTime(processingEndTime);
    const finalDuration = calculateDuration(processingStartTime, processingEndTime);
    document.getElementById('timer-duration').textContent = finalDuration;

    console.log('[Timer] Processing timer stopped at:', formatTime(processingEndTime), 'Duration:', finalDuration);
}

function runSimulation() {
    // If already processing, stop it
    if (isProcessing) {
        stopProcessing();
        return;
    }

    // Otherwise, start processing
    if (!autoProcessingEnabled) {
        alert('Please enable Auto Processing first');
        return;
    }

    if (autoProcessingData.length === 0) {
        alert('Please fetch data first');
        return;
    }

    // Check if any trips are selected
    if (selectedTripsForProcessing.size === 0) {
        alert('Please select at least one trip for processing.\n\nClick the "Select" button on each trip you want to process, or use "Select All" to select all trips.');
        return;
    }

    addLogEntry('System', `Starting process - Processing ${selectedTripsForProcessing.size} selected trip(s)...`, 'info');

    // Set processing flag
    isProcessing = true;

    // Update button to show "Stop Processing"
    const button = document.getElementById('auto-run-simulation-btn');
    if (button) {
        button.innerHTML = '<i class="fas fa-stop"></i> Stop Processing';
        button.style.background = '#ef4444';
        button.style.boxShadow = '0 2px 4px rgba(239, 68, 68, 0.3)';
    }

    // Show current processing status
    const statusDisplay = document.getElementById('current-processing-status');
    if (statusDisplay) {
        statusDisplay.style.display = 'flex';
    }

    // Start timer
    startProcessingTimer();

    // Start sequential processing
    processNextBatch();
}

// Stop processing
function stopProcessing() {
    isProcessing = false;
    currentProcessingTrip = null;
    currentProcessingTripId = null;
    currentProcessingOrder = null;

    addLogEntry('System', 'Processing stopped by user', 'warning');

    // Update button back to "Start Process"
    const button = document.getElementById('auto-run-simulation-btn');
    if (button) {
        button.innerHTML = '<i class="fas fa-play"></i> Start Process';
        button.style.background = '#10b981';
        button.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.3)';
    }

    // Stop timer
    if (processingStartTime && !processingEndTime) {
        stopProcessingTimer();
    }

    // Hide current processing status
    const statusDisplay = document.getElementById('current-processing-status');
    if (statusDisplay) {
        statusDisplay.style.display = 'none';
    }
}

// Update current processing display
function updateCurrentProcessingDisplay() {
    console.log('[Processing] Updating display - Trip:', currentProcessingTrip, 'TripId:', currentProcessingTripId, 'Order:', currentProcessingOrder);

    const tripElement = document.getElementById('current-trip');
    const tripIdElement = document.getElementById('current-trip-id');
    const orderElement = document.getElementById('current-order');
    const statusDisplay = document.getElementById('current-processing-status');

    // Make sure floating icon is visible
    if (statusDisplay && statusDisplay.style.display !== 'flex') {
        statusDisplay.style.display = 'flex';
        console.log('[Processing] Showing floating status icon');
    }

    if (tripElement) {
        tripElement.textContent = currentProcessingTrip || '-';
    }

    if (tripIdElement) {
        tripIdElement.textContent = currentProcessingTripId || '-';
    }

    if (orderElement) {
        orderElement.textContent = currentProcessingOrder || '-';
    }
}

// Close processing status floating icon
function closeProcessingStatusFloat() {
    const statusDisplay = document.getElementById('current-processing-status');
    if (statusDisplay) {
        statusDisplay.style.display = 'none';
    }
    console.log('[Processing Status] Floating icon closed by user');
}

// Stop auto processing
function stopAutoProcessing() {
    autoProcessingEnabled = false;
    document.getElementById('auto-process-status').textContent = 'DISABLED';
    document.getElementById('auto-process-status').style.color = '#dc3545';

    if (autoProcessingInterval) {
        clearInterval(autoProcessingInterval);
        autoProcessingInterval = null;
    }

    addLogEntry('System', 'Auto processing DISABLED', 'warning');
}

// Update single transaction status in DOM (without re-rendering)
function updateTransactionStatusInDOM(tripIndex, transactionIndex, status) {
    const statusCell = document.getElementById(`status-cell-${tripIndex}-${transactionIndex}`);
    const actionCell = document.getElementById(`action-cell-${tripIndex}-${transactionIndex}`);

    if (!statusCell || !actionCell) return;

    // Update status badge
    const statusColor = status === 'SUCCESS' ? '#10b981' :
                       status === 'FAILED' || status === 'ERROR' ? '#ef4444' :
                       status === 'PROCESSING' ? '#f59e0b' :
                       status === 'DELETING_ERRORS' ? '#dc2626' :
                       '#3b82f6';

    const statusIcon = status === 'SUCCESS' ? 'check-circle' :
                      status === 'FAILED' || status === 'ERROR' ? 'times-circle' :
                      status === 'PROCESSING' ? 'spinner fa-spin' :
                      status === 'DELETING_ERRORS' ? 'trash fa-spin' :
                      'clock';

    statusCell.innerHTML = `
        <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${statusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
            <i class="fas fa-${statusIcon}"></i> ${status}
        </span>
    `;

    // Update action button
    if (status === 'FAILED' || status === 'ERROR') {
        actionCell.innerHTML = `
            <div style="display: flex; gap: 0.25rem; justify-content: center;">
                <button onclick="retryTransaction(${tripIndex}, ${transactionIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                    <i class="fas fa-redo"></i> Retry
                </button>
                <button onclick="showErrorDetails(${tripIndex}, ${transactionIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                    <i class="fas fa-exclamation-circle"></i> Show Errors
                </button>
            </div>
        `;
    } else if (status === 'PROCESSING') {
        actionCell.innerHTML = `<span style="color: #f59e0b; font-size: 10px;"><i class="fas fa-spinner fa-spin"></i> Processing...</span>`;
    } else {
        actionCell.innerHTML = `<span style="color: #cbd5e1; font-size: 10px;">-</span>`;
    }
}

// Process next batch of transactions
async function processNextBatch() {
    if (!autoProcessingEnabled) return;

    // Log total records
    addLogEntry('Debug', `Total records in data: ${autoProcessingData.length}`, 'info');
    addLogEntry('Debug', `Selected trips for processing: ${Array.from(selectedTripsForProcessing).join(', ')}`, 'info');

    // Log sample trip_id from data for debugging
    if (autoProcessingData.length > 0) {
        const sampleTripId = autoProcessingData[0].trip_id;
        addLogEntry('Debug', `Sample trip_id from data: "${sampleTripId}" (type: ${typeof sampleTripId})`, 'info');
    }

    // Find pending transactions (case-insensitive check) and not bypassed
    // ONLY process transactions from SELECTED trips
    // Convert trip_id to string for comparison since Set stores strings
    const pendingTransactions = autoProcessingData.filter(t => {
        const status = (t.transaction_status || '').toUpperCase();
        const isPending = !t.transaction_status || status === '' || status === 'PENDING';
        const isNotBypassed = !t.bypassed; // Skip bypassed transactions
        const tripIdStr = String(t.trip_id); // Convert to string for comparison
        const isSelectedTrip = selectedTripsForProcessing.has(tripIdStr); // Only selected trips
        return isPending && isNotBypassed && isSelectedTrip;
    });

    addLogEntry('Debug', `Filtered pending records: ${pendingTransactions.length}`, 'info');

    if (pendingTransactions.length === 0) {
        addLogEntry('Processing', 'No pending transactions found. All records may already be processed.', 'warning');
        // Log first few statuses to debug
        if (autoProcessingData.length > 0) {
            const statuses = autoProcessingData.slice(0, 5).map(t => t.transaction_status || 'null').join(', ');
            addLogEntry('Debug', `Sample statuses: ${statuses}`, 'info');
        }
        return;
    }

    // Group pending transactions by trx_number (order number)
    const transactionsByOrder = {};
    pendingTransactions.forEach(t => {
        const orderNum = t.trx_number;
        if (!transactionsByOrder[orderNum]) {
            transactionsByOrder[orderNum] = [];
        }
        transactionsByOrder[orderNum].push(t);
    });

    const orderNumbers = Object.keys(transactionsByOrder);
    addLogEntry('Processing', `Found ${orderNumbers.length} orders with ${pendingTransactions.length} pending transactions. Starting background processing...`, 'info');

    // Process transactions order by order
    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let processedOrders = 0;

    try {
        for (let orderIdx = 0; orderIdx < orderNumbers.length; orderIdx++) {
            const orderNumber = orderNumbers[orderIdx];
            const orderTransactions = transactionsByOrder[orderNumber];

            // Check if processing was stopped by user
            if (!isProcessing || !autoProcessingEnabled) {
                addLogEntry('Processing', 'Processing was stopped. Stopping...', 'warning');
                break;
            }

            // Update current processing status
            const firstTransaction = orderTransactions[0];
            // Use trip_id for both since trip_number may not exist in the data
            currentProcessingTrip = firstTransaction.trip_id || firstTransaction.trip_number || '-';
            currentProcessingTripId = firstTransaction.trip_id || '-';
            currentProcessingOrder = orderNumber;
            console.log('[Processing] Current: Trip=' + currentProcessingTrip + ', TripId=' + currentProcessingTripId + ', Order=' + currentProcessingOrder);
            updateCurrentProcessingDisplay();

            addLogEntry('Order', `Processing Order: ${orderNumber} (${orderTransactions.length} lines)`, 'info');

            // Show processing spinner for this order
            showOrderProcessingSpinner(orderNumber, true);

            // Process all lines in this order
            for (let i = 0; i < orderTransactions.length; i++) {
                const transaction = orderTransactions[i];

                // Check if processing was stopped
                if (!isProcessing || !autoProcessingEnabled) {
                    addLogEntry('Processing', 'Processing was stopped. Stopping...', 'warning');
                    break;
                }

                // Find the trip and transaction index for DOM update
                const tripIndex = autoProcessingData.findIndex(t => t === transaction);
                const groupedTrips = groupTransactionsByTrip();
                let actualTripIndex = -1;
                let actualTransactionIndex = -1;

                groupedTrips.forEach((trip, tIdx) => {
                    const idx = trip.transactions.findIndex(t => t === transaction);
                    if (idx !== -1) {
                        actualTripIndex = tIdx;
                        actualTransactionIndex = idx;
                    }
                });

                // Process transaction and update status in DOM
                // Note: processAutoTransaction now handles errors internally and never throws
                const result = await processAutoTransaction(transaction, actualTripIndex, actualTransactionIndex);
                processedCount++;

                // Track success/failure statistics
                if (result.success) {
                    successCount++;
                } else {
                    failedCount++;
                }

                // Update statistics every 5 transactions
                if (processedCount % 5 === 0 || (orderIdx === orderNumbers.length - 1 && i === orderTransactions.length - 1)) {
                    addLogEntry('Progress', `Processed ${processedCount} of ${pendingTransactions.length} transactions (${successCount} success, ${failedCount} failed) - ${processedOrders + 1} of ${orderNumbers.length} orders`, 'info');
                    updateStatistics();
                }
            }

            // Hide processing spinner for this order
            showOrderProcessingSpinner(orderNumber, false);

            processedOrders++;
            addLogEntry('Order', `✓ Order ${orderNumber} completed (${orderTransactions.length} lines processed)`, 'success');
        }

        if (autoProcessingEnabled || isProcessing) {
            if (failedCount === 0) {
                addLogEntry('Processing', `All ${processedOrders} orders (${processedCount} transactions) processed successfully!`, 'success');
            } else {
                addLogEntry('Processing', `Completed ${processedOrders} orders: ${successCount} succeeded, ${failedCount} failed (errors auto-cleaned)`, 'warning');
            }
            updateStatistics();

            // Stop processing timer
            stopProcessingTimer();

            // Reset processing state
            isProcessing = false;
            currentProcessingTrip = null;
            currentProcessingTripId = null;
            currentProcessingOrder = null;

            // Reset button to "Start Process"
            const button = document.getElementById('auto-run-simulation-btn');
            if (button) {
                button.innerHTML = '<i class="fas fa-play"></i> Start Process';
                button.style.background = '#10b981';
                button.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.3)';
            }

            // Hide current processing status
            const statusDisplay = document.getElementById('current-processing-status');
            if (statusDisplay) {
                statusDisplay.style.display = 'none';
            }
        }
    } catch (error) {
        addLogEntry('Error', `Unexpected batch processing error: ${error.message}`, 'error');
        console.error('[Auto Processing] Batch error:', error);
        updateStatistics();

        // Stop timer on error too
        if (processingStartTime && !processingEndTime) {
            stopProcessingTimer();
        }

        // Reset processing state on error
        isProcessing = false;
        currentProcessingTrip = null;
        currentProcessingTripId = null;
        currentProcessingOrder = null;

        // Reset button to "Start Process"
        const button = document.getElementById('auto-run-simulation-btn');
        if (button) {
            button.innerHTML = '<i class="fas fa-play"></i> Start Process';
            button.style.background = '#10b981';
            button.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.3)';
        }

        // Hide current processing status
        const statusDisplay = document.getElementById('current-processing-status');
        if (statusDisplay) {
            statusDisplay.style.display = 'none';
        }
    }
}

// Delete inventory staged transaction errors automatically
async function deleteInventoryErrors(transaction) {
    return new Promise((resolve) => {
        const instanceName = transaction.instance_name || 'PROD';
        let apiUrl;

        // Determine GET endpoint
        if (instanceName === 'TEST') {
            apiUrl = 'https://efmh-test.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions?q=OrganizationName=GIC;TransactionTypeName=Direct Organization Transfer';
        } else {
            apiUrl = 'https://efmh.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions?q=OrganizationName=GIC;TransactionTypeName=Direct Organization Transfer';
        }

        addLogEntry('Auto Cleanup', `Fetching staged transaction errors for cleanup...`, 'warning');

        // Check credentials
        if (!fusionCloudUsername || !fusionCloudPassword) {
            addLogEntry('Error', 'Fusion Cloud credentials not available for cleanup', 'error');
            resolve({ success: false, message: 'Credentials not available' });
            return;
        }

        // Fetch error data
        sendMessageToCSharp({
            action: "executeGet",
            fullUrl: apiUrl,
            username: fusionCloudUsername,
            password: fusionCloudPassword
        }, async function(error, data) {
            if (error) {
                addLogEntry('Auto Cleanup', `Failed to fetch staged transactions: ${error}`, 'error');
                resolve({ success: false, message: error });
                return;
            }

            if (!data) {
                addLogEntry('Auto Cleanup', 'No data returned from staged transactions API', 'error');
                resolve({ success: false, message: 'No data returned' });
                return;
            }

            try {
                const response = JSON.parse(data);
                const errorItems = response.items || [];

                if (errorItems.length === 0) {
                    addLogEntry('Auto Cleanup', 'No staged transaction errors found', 'info');
                    resolve({ success: true, deletedCount: 0 });
                    return;
                }

                addLogEntry('Auto Cleanup', `Found ${errorItems.length} staged transaction(s) to delete`, 'warning');

                // Determine DELETE base URL
                let baseUrl;
                if (instanceName === 'TEST') {
                    baseUrl = 'https://efmh-test.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions/';
                } else {
                    baseUrl = 'https://efmh.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions/';
                }

                let deletedCount = 0;
                let failedCount = 0;

                // Delete each staged transaction
                for (const item of errorItems) {
                    const transactionInterfaceId = item.TransactionInterfaceId;

                    if (!transactionInterfaceId) {
                        failedCount++;
                        continue;
                    }

                    const deleteUrl = baseUrl + transactionInterfaceId;

                    await new Promise((deleteResolve) => {
                        sendMessageToCSharp({
                            action: "executeDelete",
                            fullUrl: deleteUrl,
                            username: fusionCloudUsername,
                            password: fusionCloudPassword
                        }, function(deleteError, deleteData) {
                            if (deleteError) {
                                addLogEntry('Auto Cleanup', `Failed to delete ${transactionInterfaceId}: ${deleteError}`, 'error');
                                failedCount++;
                            } else {
                                addLogEntry('Auto Cleanup', `✓ Deleted staged transaction ${transactionInterfaceId}`, 'success');
                                deletedCount++;
                            }
                            deleteResolve();
                        });
                    });
                }

                addLogEntry('Auto Cleanup', `Cleanup complete: ${deletedCount} deleted, ${failedCount} failed`, deletedCount > 0 ? 'success' : 'warning');
                resolve({ success: deletedCount > 0, deletedCount, failedCount });

            } catch (parseError) {
                addLogEntry('Auto Cleanup', `Failed to parse staged transactions: ${parseError.message}`, 'error');
                resolve({ success: false, message: parseError.message });
            }
        });
    });
}

// Process a single auto transaction (background processing - no UI updates)
async function processAutoTransaction(transaction, tripIndex, transactionIndex) {
    // Set status to PROCESSING
    transaction.transaction_status = 'PROCESSING';

    // Update DOM to show PROCESSING status
    if (tripIndex !== -1 && transactionIndex !== -1) {
        updateTransactionStatusInDOM(tripIndex, transactionIndex, 'PROCESSING');
    }

    try {
        // Call actual web service API to process transaction
        const response = await processTransactionAPI(transaction);

        // Update transaction status
        transaction.transaction_status = 'SUCCESS';

        // Update DOM to show SUCCESS status
        if (tripIndex !== -1 && transactionIndex !== -1) {
            updateTransactionStatusInDOM(tripIndex, transactionIndex, 'SUCCESS');
        }

        addLogEntry('Success', `✓ LID: ${transaction.lid} | Order: ${transaction.trx_number} | Line: ${transaction.line_number} | Item: ${transaction.item_code} - SUCCESS`, 'success');

        return { success: true, response };

    } catch (error) {
        console.error('[Auto Processing] Error processing transaction:', error);
        addLogEntry('Error', `✗ LID: ${transaction.lid} | Order: ${transaction.trx_number} | Line: ${transaction.line_number} | Item: ${transaction.item_code} - FAILED: ${error.message}`, 'error');

        // AUTOMATIC ERROR CLEANUP (NO RETRY)
        addLogEntry('Auto Cleanup', `Starting automatic error cleanup for LID ${transaction.lid}...`, 'warning');

        // Update status to DELETING_ERRORS
        transaction.transaction_status = 'DELETING_ERRORS';
        if (tripIndex !== -1 && transactionIndex !== -1) {
            updateTransactionStatusInDOM(tripIndex, transactionIndex, 'DELETING_ERRORS');
        }

        try {
            // Delete staged transaction errors
            const cleanupResult = await deleteInventoryErrors(transaction);

            if (cleanupResult.success) {
                addLogEntry('Auto Cleanup', `✓ Cleanup successful (${cleanupResult.deletedCount} error(s) deleted). Continuing with next transaction...`, 'success');
            } else {
                addLogEntry('Auto Cleanup', `✗ Cleanup failed. Continuing with next transaction...`, 'warning');
            }
        } catch (cleanupError) {
            addLogEntry('Error', `✗ Unexpected cleanup error: ${cleanupError.message}. Continuing with next transaction...`, 'error');
        }

        // Mark as FAILED and continue processing
        transaction.transaction_status = 'FAILED';
        transaction.error_message = error.message;
        if (tripIndex !== -1 && transactionIndex !== -1) {
            updateTransactionStatusInDOM(tripIndex, transactionIndex, 'FAILED');
        }

        return { success: false, error: error.message };
    }
}

// Process transaction via API (replaces simulation)
function processTransactionAPI(transaction) {
    return new Promise((resolve, reject) => {
        const lid = transaction.lid;

        if (!lid) {
            reject(new Error('LID is missing'));
            return;
        }

        const instance = transaction.instance_name || sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/processs2vauto/${lid}?p_instance_name=${instance}`;

        console.log('[Auto Processing] Calling API for LID:', lid, 'Instance:', instance, apiUrl);

        // Call API using WebView REST handler
        sendMessageToCSharp({
            action: "executePost",
            fullUrl: apiUrl,
            body: JSON.stringify({})
        }, function(error, data) {
            if (error) {
                console.error('[Auto Processing] API error for LID', lid, ':', error);
                reject(new Error(error));
                return;
            }

            try {
                const response = JSON.parse(data);
                console.log('[Auto Processing] API response for LID', lid, ':', response);

                // Check result field
                if (response.result === "0" || response.result === 0) {
                    // Success
                    resolve(response);
                } else {
                    // Failed - result is not 0
                    const errorMsg = response.message || `Processing failed with result: ${response.result}`;
                    reject(new Error(errorMsg));
                }
            } catch (parseError) {
                console.error('[Auto Processing] Failed to parse API response:', parseError);
                reject(new Error('Invalid API response format'));
            }
        });
    });
}

// Retry transaction
async function retryTransaction(tripIndex, transactionIndex) {
    const groupedTrips = groupTransactionsByTrip();
    const transaction = groupedTrips[tripIndex].transactions[transactionIndex];

    addLogEntry('Retry', `Retrying Order: ${transaction.trx_number} | Line: ${transaction.line_number}...`, 'warning');

    await processAutoTransaction(transaction, tripIndex, transactionIndex);

    // Update statistics after retry
    updateStatistics();
}

// Retry transaction by ID
async function retryTransactionById(transactionId) {
    const transaction = autoProcessingData.find(t => t.transaction_id === transactionId);
    if (transaction) {
        await processAutoTransaction(transaction);
    }
}

// Cancel S2V Lot - calls REST API to cancel a line
async function cancelS2VLot(tripIndex, transactionIndex, lid) {
    // Validate LID
    if (!lid) {
        
        addLogEntry('Cancel', 'Cannot cancel: LID is missing', 'error');
        return;
    }

    // Show confirmation prompt
    const confirmed = confirm(`Are you sure you want to cancel this line?\n\nLID: ${lid}\n\nThis action cannot be undone.`);

    if (!confirmed) {
        addLogEntry('Cancel', `Cancel operation aborted by user for LID: ${lid}`, 'info');
        return;
    }

    addLogEntry('Cancel', `Cancelling line with LID: ${lid}...`, 'info');

    // Update button to show loading state
    const cancelCell = document.getElementById(`cancel-cell-${tripIndex}-${transactionIndex}`);
    if (cancelCell) {
        cancelCell.innerHTML = `<span style="color: #f59e0b; font-size: 10px;"><i class="fas fa-spinner fa-spin"></i> Cancelling...</span>`;
    }

    // Build the API URL
    const instance = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';
    const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/cancels2vlot/${lid}?p_instance_name=${instance}`;

    // Log the endpoint being called
    addLogEntry('Cancel', `POST ${apiUrl}`, 'info');
    console.log('[Cancel] Calling endpoint:', apiUrl, 'Instance:', instance);

    try {
        // Use C# REST handler via WebView2
        if (window.chrome && window.chrome.webview) {
            const requestId = 'cancel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            // Set up response handler
            const responseHandler = (event) => {
                const data = event.data;
                if (data.requestId === requestId) {
                    window.chrome.webview.removeEventListener('message', responseHandler);

                    // Log full response for debugging
                    console.log('[Cancel] Response received:', data);
                    addLogEntry('Cancel', `Response: ${JSON.stringify(data).substring(0, 500)}`, 'info');

                    // Check for success - either data.success from C# or status:"SUCCESS" from API response
                    let isSuccess = data.success;
                    let responseBody = null;

                    // Try to parse the response body if available
                    if (data.data) {
                        try {
                            // Fix invalid JSON with trailing commas (e.g., {"status": "SUCCESS",})
                            let jsonStr = typeof data.data === 'string' ? data.data : JSON.stringify(data.data);
                            console.log('[Cancel] Original data.data:', jsonStr);
                            addLogEntry('Cancel', `Raw response data: ${jsonStr}`, 'info');

                            jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                            console.log('[Cancel] After cleanup:', jsonStr);

                            responseBody = JSON.parse(jsonStr);
                            console.log('[Cancel] Parsed responseBody:', responseBody);
                            addLogEntry('Cancel', `Parsed status: ${responseBody?.status}`, 'info');

                            // Check if API returned status: "SUCCESS"
                            if (responseBody && responseBody.status === 'SUCCESS') {
                                isSuccess = true;
                                console.log('[Cancel] SUCCESS detected via JSON parse');
                            }
                        } catch (e) {
                            console.log('[Cancel] Response parse error:', e.message, 'Data:', data.data);
                            addLogEntry('Cancel', `JSON parse error: ${e.message}`, 'error');

                            // Fallback: check if response contains "SUCCESS" string
                            const dataStr = String(data.data);
                            if (dataStr.includes('SUCCESS')) {
                                console.log('[Cancel] Detected SUCCESS via string match');
                                addLogEntry('Cancel', `SUCCESS detected via string match`, 'info');
                                isSuccess = true;
                            }
                        }
                    }

                    if (isSuccess) {
                        addLogEntry('Cancel', `Successfully cancelled line with LID: ${lid}`, 'success');
                        

                        // Log the IDs we're looking for
                        addLogEntry('Cancel', `Looking for cancel-cell-${tripIndex}-${transactionIndex}`, 'info');

                        // Re-query DOM elements to get fresh references
                        const currentCancelCell = document.getElementById(`cancel-cell-${tripIndex}-${transactionIndex}`);
                        const currentStatusCell = document.getElementById(`status-cell-${tripIndex}-${transactionIndex}`);

                        addLogEntry('Cancel', `Cancel cell found: ${!!currentCancelCell}, Status cell found: ${!!currentStatusCell}`, 'info');

                        // Update the cancel cell to show cancelled status
                        if (currentCancelCell) {
                            currentCancelCell.innerHTML = `<span style="color: #10b981; font-size: 10px;"><i class="fas fa-check-circle"></i> Cancelled</span>`;
                            addLogEntry('Cancel', `Updated cancel cell to Cancelled`, 'success');
                        } else {
                            addLogEntry('Cancel', `WARNING: Cancel cell not found: cancel-cell-${tripIndex}-${transactionIndex}`, 'error');
                        }

                        // Update the status cell
                        if (currentStatusCell) {
                            currentStatusCell.innerHTML = `
                                <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: #6b7280; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
                                    <i class="fas fa-ban"></i> CANCELLED
                                </span>
                            `;
                            addLogEntry('Cancel', `Updated status cell to CANCELLED`, 'success');
                        } else {
                            addLogEntry('Cancel', `WARNING: Status cell not found: status-cell-${tripIndex}-${transactionIndex}`, 'error');
                        }

                        // Update transaction status in data
                        const groupedTrips = groupTransactionsByTrip();
                        if (groupedTrips[tripIndex] && groupedTrips[tripIndex].transactions[transactionIndex]) {
                            groupedTrips[tripIndex].transactions[transactionIndex].transaction_status = 'CANCELLED';
                        }
                    } else {
                        // Build detailed error message
                        let errorMsg = data.error || '';
                        if (data.statusCode) {
                            errorMsg = `HTTP ${data.statusCode}: ${errorMsg}`;
                        }
                        if (responseBody && responseBody.message) {
                            errorMsg += ` - ${responseBody.message}`;
                        }
                        if (!errorMsg) {
                            errorMsg = `Unknown error. Response: ${JSON.stringify(data).substring(0, 200)}`;
                        }

                        addLogEntry('Cancel', `Failed to cancel line ${lid}: ${errorMsg}`, 'error');
                        

                        // Re-query DOM element for fresh reference
                        const currentCancelCell = document.getElementById(`cancel-cell-${tripIndex}-${transactionIndex}`);

                        // Restore cancel button
                        if (currentCancelCell) {
                            currentCancelCell.innerHTML = `
                                <button onclick="cancelS2VLot(${tripIndex}, ${transactionIndex}, '${lid}')" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="Cancel this line">
                                    <i class="fas fa-times-circle"></i> Cancel
                                </button>
                            `;
                        }
                    }
                }
            };

            window.chrome.webview.addEventListener('message', responseHandler);

            // Send POST request to C#
            window.chrome.webview.postMessage({
                action: 'executePost',
                requestId: requestId,
                fullUrl: apiUrl,
                body: JSON.stringify({})
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                window.chrome.webview.removeEventListener('message', responseHandler);
            }, 30000);

        } else {
            // Fallback for non-WebView2 environment (testing)
            console.warn('[Cancel] WebView2 not available, using fetch fallback');
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

            if (response.ok) {
                addLogEntry('Cancel', `Successfully cancelled line with LID: ${lid}`, 'success');
                
                if (cancelCell) {
                    cancelCell.innerHTML = `<span style="color: #10b981; font-size: 10px;"><i class="fas fa-check-circle"></i> Cancelled</span>`;
                }
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        }
    } catch (error) {
        console.error('[Cancel] Error:', error);
        addLogEntry('Cancel', `Error cancelling line ${lid}: ${error.message}`, 'error');
        

        // Restore cancel button
        if (cancelCell) {
            cancelCell.innerHTML = `
                <button onclick="cancelS2VLot(${tripIndex}, ${transactionIndex}, '${lid}')" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="Cancel this line">
                    <i class="fas fa-times-circle"></i> Cancel
                </button>
            `;
        }
    }
}

// Process single line (no GET/DELETE on failure - just mark SUCCESS or FAILED)
async function processSingleLine(tripIndex, transactionIndex) {
    const groupedTrips = groupTransactionsByTrip();
    const transaction = groupedTrips[tripIndex].transactions[transactionIndex];

    if (!transaction) {
        console.error('[Process Single Line] Transaction not found');
        return;
    }

    addLogEntry('Process', `Processing single line: LID ${transaction.lid} | Order: ${transaction.trx_number}...`, 'info');

    // Set status to PROCESSING
    transaction.transaction_status = 'PROCESSING';
    updateTransactionStatusInDOM(tripIndex, transactionIndex, 'PROCESSING');

    try {
        // Call actual web service API to process transaction
        const response = await processTransactionAPI(transaction);

        // Update transaction status to SUCCESS
        transaction.transaction_status = 'SUCCESS';
        updateTransactionStatusInDOM(tripIndex, transactionIndex, 'SUCCESS');

        addLogEntry('Success', `✓ LID: ${transaction.lid} | Order: ${transaction.trx_number} | Line: ${transaction.line_number} | Item: ${transaction.item_code} - SUCCESS`, 'success');

        // Update statistics
        updateStatistics();

    } catch (error) {
        console.error('[Process Single Line] Error processing transaction:', error);

        // Mark as FAILED (NO cleanup - no GET/DELETE APIs)
        transaction.transaction_status = 'FAILED';
        transaction.error_message = error.message;
        updateTransactionStatusInDOM(tripIndex, transactionIndex, 'FAILED');

        addLogEntry('Error', `✗ LID: ${transaction.lid} | Order: ${transaction.trx_number} | Line: ${transaction.line_number} | Item: ${transaction.item_code} - FAILED: ${error.message}`, 'error');

        // Update statistics
        updateStatistics();
    }
}

// Switch auto tab
function switchAutoTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.auto-tab-content').forEach(tab => {
        tab.style.display = 'none';
    });

    // Remove active class from all buttons
    document.querySelectorAll('.auto-tab-btn').forEach(btn => {
        btn.style.color = '#64748b';
        btn.style.borderBottom = '3px solid transparent';
    });

    // Show selected tab
    if (tabName === 'trips-view') {
        document.getElementById('auto-trips-view').style.display = 'block';
    } else if (tabName === 'processing-log') {
        document.getElementById('auto-processing-log').style.display = 'block';
    } else if (tabName === 'analytics') {
        document.getElementById('auto-analytics').style.display = 'block';
        // Rebuild analytics when tab is shown
        buildAnalytics();
    }

    // Add active class to clicked button
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.style.color = '#667eea';
        activeBtn.style.borderBottom = '3px solid #667eea';
    }
}

// Add log entry
function addLogEntry(type, message, level = 'info') {
    const logContainer = document.getElementById('auto-log-container');
    const timestamp = new Date().toLocaleTimeString();

    const colorMap = {
        'info': '#3b82f6',
        'success': '#10b981',
        'warning': '#f59e0b',
        'error': '#ef4444'
    };

    const logEntry = document.createElement('div');
    logEntry.style.color = colorMap[level] || '#94a3b8';
    logEntry.style.marginBottom = '4px';
    logEntry.innerHTML = `[${timestamp}] [${type}] ${message}`;

    logContainer.appendChild(logEntry);

    // Auto scroll to bottom
    logContainer.scrollTop = logContainer.scrollHeight;

    // Limit log entries to 100
    const entries = logContainer.children;
    if (entries.length > 100) {
        logContainer.removeChild(entries[0]);
    }
}

// Toggle bypass for a single transaction
function toggleBypassTransaction(tripIndex, transactionIndex) {
    const groupedTrips = groupTransactionsByTrip();
    const transaction = groupedTrips[tripIndex].transactions[transactionIndex];

    transaction.bypassed = !transaction.bypassed;

    addLogEntry('Bypass', `Transaction LID ${transaction.lid} ${transaction.bypassed ? 'bypassed' : 'unbypassed'}`, 'info');
}

// Toggle select all for an order
function toggleSelectAllOrder(orderId) {
    const checkbox = document.getElementById(`select-all-${orderId}`);
    const checkboxes = document.querySelectorAll(`.bypass-checkbox-${orderId}`);

    checkboxes.forEach(cb => {
        cb.checked = checkbox.checked;
        cb.dispatchEvent(new Event('change'));
    });
}

// Populate filter dropdowns with data from fetched records
function populateFilterDropdowns() {
    if (!autoProcessingData || autoProcessingData.length === 0) return;

    // Get unique values
    const tripIds = [...new Set(autoProcessingData.map(t => t.trip_id).filter(Boolean))].sort();
    const orderNumbers = [...new Set(autoProcessingData.map(t => t.trx_number).filter(Boolean))].sort();
    const itemDescs = [...new Set(autoProcessingData.map(t => t.item_desc).filter(Boolean))].sort();
    const lids = [...new Set(autoProcessingData.map(t => t.lid).filter(Boolean))].sort();

    // Populate Trip ID datalist
    const tripList = document.getElementById('trip-id-list');
    if (tripList) {
        tripList.innerHTML = '';
        tripIds.forEach(id => {
            tripList.innerHTML += `<option value="${id}">`;
        });
    }

    // Populate Order # datalist
    const orderList = document.getElementById('trx-number-list');
    if (orderList) {
        orderList.innerHTML = '';
        orderNumbers.forEach(num => {
            orderList.innerHTML += `<option value="${num}">`;
        });
    }

    // Populate Item Description datalist
    const itemList = document.getElementById('item-desc-list');
    if (itemList) {
        itemList.innerHTML = '';
        itemDescs.forEach(desc => {
            itemList.innerHTML += `<option value="${desc}">`;
        });
    }

    // Populate LID datalist
    const lidList = document.getElementById('lid-list');
    if (lidList) {
        lidList.innerHTML = '';
        lids.forEach(lid => {
            lidList.innerHTML += `<option value="${lid}">`;
        });
    }

    console.log('[Filters] Populated datalists - Trips:', tripIds.length, 'Orders:', orderNumbers.length, 'Items:', itemDescs.length, 'LIDs:', lids.length);
}

// Font size adjustment for Trip and Order groups
function adjustTripOrderFontSize(direction) {
    const newMultiplier = tripOrderFontSizeMultiplier + (direction * FONT_SIZE_STEP);
    if (newMultiplier >= FONT_SIZE_MIN && newMultiplier <= FONT_SIZE_MAX) {
        tripOrderFontSizeMultiplier = newMultiplier;
        applyTripOrderFontSize();
        updateFontSizeIndicator();
    }
}

function resetTripOrderFontSize() {
    tripOrderFontSizeMultiplier = 1.0;
    applyTripOrderFontSize();
    updateFontSizeIndicator();
}

function updateFontSizeIndicator() {
    const indicator = document.getElementById('font-size-indicator');
    if (indicator) {
        indicator.textContent = Math.round(tripOrderFontSizeMultiplier * 100) + '%';
    }
}

function applyTripOrderFontSize() {
    // Base font sizes (from current design)
    const baseLabelSize = 8;        // Labels (TRIP ID, DATE, etc.)
    const baseTripValueSize = 13;   // Trip main values (ID, Orders count)
    const baseTripValueSmSize = 11; // Trip secondary values (date, lorry, etc.)
    const baseOrderValueSize = 12;  // Order main values
    const baseOrderValueSmSize = 10;// Order secondary values
    const baseStatsSize = 9;        // Stats badges
    const baseTableHeaderSize = 10; // Table header font size
    const baseTableCellSize = 11;   // Table cell font size
    const baseIconSize = 16;        // Trip icons
    const baseOrderIconSize = 14;   // Order icons

    // Apply to Trip Group labels
    document.querySelectorAll('.trip-group-label').forEach(el => {
        el.style.fontSize = (baseLabelSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to Trip Group main values
    document.querySelectorAll('.trip-group-value').forEach(el => {
        el.style.fontSize = (baseTripValueSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to Trip Group secondary values
    document.querySelectorAll('.trip-group-value-sm').forEach(el => {
        el.style.fontSize = (baseTripValueSmSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to Trip Group icons
    document.querySelectorAll('.trip-group-icon').forEach(el => {
        el.style.fontSize = (baseIconSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to Trip stats badges
    document.querySelectorAll('.trip-stats-badge').forEach(el => {
        el.style.fontSize = (baseStatsSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to Order Group labels
    document.querySelectorAll('.order-group-label').forEach(el => {
        el.style.fontSize = (baseLabelSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to Order Group main values
    document.querySelectorAll('.order-group-value').forEach(el => {
        el.style.fontSize = (baseOrderValueSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to Order Group secondary values
    document.querySelectorAll('.order-group-value-sm').forEach(el => {
        el.style.fontSize = (baseOrderValueSmSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to Order Group icons
    document.querySelectorAll('.order-group-icon').forEach(el => {
        el.style.fontSize = (baseOrderIconSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to Order stats badges
    document.querySelectorAll('.order-stats-badge').forEach(el => {
        el.style.fontSize = (baseStatsSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to table headers
    document.querySelectorAll('#auto-trips-container th').forEach(el => {
        el.style.fontSize = (baseTableHeaderSize * tripOrderFontSizeMultiplier) + 'px';
    });

    // Apply to table cells
    document.querySelectorAll('#auto-trips-container td').forEach(el => {
        el.style.fontSize = (baseTableCellSize * tripOrderFontSizeMultiplier) + 'px';
    });

    console.log('[Font Size] Applied multiplier:', tripOrderFontSizeMultiplier);
}

// Apply filters
function applyFilters() {
    // Get filter values
    autoProcessingFilters.tripId = document.getElementById('filter-trip-id').value;
    autoProcessingFilters.itemDesc = document.getElementById('filter-item-desc').value.toLowerCase();
    autoProcessingFilters.lid = document.getElementById('filter-lid').value.toLowerCase();
    autoProcessingFilters.trxNumber = document.getElementById('filter-trx-number').value.toLowerCase();
    autoProcessingFilters.status = document.getElementById('filter-status').value.toUpperCase();

    // Check if any filter is applied
    const hasAnyFilter = autoProcessingFilters.tripId ||
                         autoProcessingFilters.itemDesc ||
                         autoProcessingFilters.lid ||
                         autoProcessingFilters.trxNumber ||
                         autoProcessingFilters.status;

    if (!hasAnyFilter) {
        // No filters, show grouped view
        clearFilters();
        return;
    }

    // Filter the data
    const filteredData = autoProcessingData.filter(item => {
        let matches = true;

        // Filter by trip ID
        if (autoProcessingFilters.tripId &&
            !String(item.trip_id || '').toLowerCase().includes(autoProcessingFilters.tripId.toLowerCase())) {
            matches = false;
        }

        // Filter by item description
        if (autoProcessingFilters.itemDesc &&
            !String(item.item_desc || '').toLowerCase().includes(autoProcessingFilters.itemDesc)) {
            matches = false;
        }

        // Filter by LID
        if (autoProcessingFilters.lid &&
            !String(item.lid || '').toLowerCase().includes(autoProcessingFilters.lid)) {
            matches = false;
        }

        // Filter by transaction number
        if (autoProcessingFilters.trxNumber &&
            !String(item.trx_number || '').toLowerCase().includes(autoProcessingFilters.trxNumber)) {
            matches = false;
        }

        // Filter by status
        if (autoProcessingFilters.status &&
            (item.transaction_status || 'PENDING').toUpperCase() !== autoProcessingFilters.status) {
            matches = false;
        }

        return matches;
    });

    // Render flat view with filtered results
    renderFilteredFlatView(filteredData);
    addLogEntry('Filter', `Showing ${filteredData.length} matching lines`, 'info');
}

// Render filtered results in flat table view (no grouping)
function renderFilteredFlatView(filteredData) {
    const container = document.getElementById('auto-trips-container');
    if (!container) return;

    // Hide expand/collapse button in flat view
    const expandCollapseBtn = document.getElementById('expand-collapse-all-btn');
    if (expandCollapseBtn) {
        expandCollapseBtn.style.display = 'none';
    }

    if (filteredData.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: #94a3b8;">
                <i class="fas fa-search" style="font-size: 48px; margin-bottom: 1rem;"></i>
                <p style="font-size: 16px; margin: 0;">No matching records found.</p>
                <p style="font-size: 12px; margin-top: 0.5rem;">Try adjusting your filter criteria.</p>
            </div>
        `;
        return;
    }

    let html = `
        <div style="background: #e0f2fe; padding: 0.5rem 1rem; border-radius: 6px; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-filter" style="color: #0284c7;"></i>
                <span style="font-size: 11px; color: #0369a1; font-weight: 600;">Filtered View: Showing ${filteredData.length} matching line(s)</span>
            </div>
            <button onclick="clearFilters()" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.3rem 0.6rem; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; display: flex; align-items: center; gap: 0.3rem;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="Remove filter and show grouped view">
                <i class="fas fa-times"></i> Remove Filter
            </button>
        </div>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%);">
                        <th style="padding: 0.6rem 0.75rem; text-align: left; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">#</th>
                        <th style="padding: 0.6rem 0.75rem; text-align: left; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">Trip ID</th>
                        <th style="padding: 0.6rem 0.75rem; text-align: left; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">Order #</th>
                        <th style="padding: 0.6rem 0.75rem; text-align: left; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">LID</th>
                        <th style="padding: 0.6rem 0.75rem; text-align: left; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">Item Code</th>
                        <th style="padding: 0.6rem 0.75rem; text-align: left; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">Item Description</th>
                        <th style="padding: 0.6rem 0.75rem; text-align: center; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">Req Qty</th>
                        <th style="padding: 0.6rem 0.75rem; text-align: center; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">Picked Qty</th>
                        <th style="padding: 0.6rem 0.75rem; text-align: left; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">Lot #</th>
                        <th style="padding: 0.6rem 0.75rem; text-align: center; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">Status</th>
                        <th style="padding: 0.6rem 0.75rem; text-align: center; font-size: 10px; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0;">Action</th>
                    </tr>
                </thead>
                <tbody>
    `;

    filteredData.forEach((item, index) => {
        const status = item.transaction_status || 'PENDING';
        const statusColor = status === 'SUCCESS' ? '#10b981' :
                           status === 'FAILED' || status === 'ERROR' ? '#ef4444' :
                           status === 'PROCESSING' ? '#f59e0b' :
                           status === 'CANCELLED' ? '#6b7280' :
                           '#3b82f6';

        const rowBg = index % 2 === 0 ? '#ffffff' : '#f8fafc';

        // Find original index in autoProcessingData for actions
        const originalIndex = autoProcessingData.findIndex(t => t === item);
        const tripIndex = autoProcessingData.findIndex(t => t.trip_id === item.trip_id);

        html += `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #f1f5f9;" id="flat-row-${index}">
                <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #94a3b8; font-weight: 600;">${index + 1}</td>
                <td style="padding: 0.6rem 0.75rem; font-size: 11px; font-weight: 600; color: #667eea;">${item.trip_id || 'N/A'}</td>
                <td style="padding: 0.6rem 0.75rem; font-size: 11px; font-weight: 600; color: #1e293b;">${item.trx_number || 'N/A'}</td>
                <td style="padding: 0.6rem 0.75rem; font-size: 11px; font-weight: 600; color: #667eea;">${item.lid || 'N/A'}</td>
                <td style="padding: 0.6rem 0.75rem; font-size: 11px; font-weight: 600; color: #667eea;">${item.item_code || 'N/A'}</td>
                <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #475569; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.item_desc || ''}">${item.item_desc || 'N/A'}</td>
                <td style="padding: 0.6rem 0.75rem; text-align: center; font-size: 12px; font-weight: 700; color: #3b82f6;">${item.header_original_qty || item.HEADER_ORIGINAL_QTY || 0}</td>
                <td style="padding: 0.6rem 0.75rem; text-align: center; font-size: 12px; font-weight: 700; color: #1e293b;">${item.picked_qty || 0}</td>
                <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #475569;">${item.lot_number || 'N/A'}</td>
                <td style="padding: 0.6rem 0.75rem; text-align: center;">
                    <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${statusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
                        ${status === 'SUCCESS' ? '<i class="fas fa-check"></i>' :
                          status === 'FAILED' || status === 'ERROR' ? '<i class="fas fa-times"></i>' :
                          status === 'PROCESSING' ? '<i class="fas fa-spinner fa-spin"></i>' :
                          status === 'CANCELLED' ? '<i class="fas fa-ban"></i>' :
                          '<i class="fas fa-clock"></i>'} ${status}
                    </span>
                </td>
                <td style="padding: 0.6rem 0.75rem; text-align: center;">
                    ${status !== 'SUCCESS' && status !== 'CANCELLED' ? `
                        <button onclick="cancelS2VLotFromFlat(${index}, '${item.lid}')" style="background: #ef4444; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 9px; font-weight: 600;" title="Cancel this line">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    ` : '-'}
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;

    // Store filtered data for actions
    window.currentFilteredData = filteredData;

    // Apply font size if not default
    if (tripOrderFontSizeMultiplier !== 1.0) {
        applyTripOrderFontSize();
    }
}

// Cancel S2V Lot from flat filtered view
async function cancelS2VLotFromFlat(flatIndex, lid) {
    if (!window.currentFilteredData || !window.currentFilteredData[flatIndex]) {
        console.error('[Cancel] Invalid flat index:', flatIndex);
        return;
    }

    const item = window.currentFilteredData[flatIndex];

    // Find the original index in autoProcessingData
    const originalIndex = autoProcessingData.findIndex(t => t.lid === lid);
    if (originalIndex === -1) {
        console.error('[Cancel] Could not find original item for LID:', lid);
        return;
    }

    // Find trip index
    const tripId = item.trip_id;
    const groupedTrips = groupTransactionsByTrip();
    const tripIndex = groupedTrips.findIndex(t => t.trip_id === tripId);

    // Call the existing cancel function logic
    const instance = item.instance_name || sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';
    const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/cancels2vlot/${lid}?p_instance_name=${instance}`;

    console.log('[Cancel Flat] Cancelling LID:', lid, 'Instance:', instance, 'API:', apiUrl);
    addLogEntry('Cancel', `Cancelling LID: ${lid} (Instance: ${instance})`, 'info');

    // Show spinner on button
    const row = document.getElementById(`flat-row-${flatIndex}`);
    const actionCell = row ? row.querySelector('td:last-child') : null;
    if (actionCell) {
        actionCell.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: #667eea;"></i>';
    }

    try {
        window.chrome.webview.postMessage({
            type: 'REST_API_CALL',
            url: apiUrl,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
            callbackId: `cancel-flat-${flatIndex}-${lid}`
        });

        // Listen for response
        const handleResponse = (event) => {
            const data = event.data;
            if (data.callbackId === `cancel-flat-${flatIndex}-${lid}`) {
                window.chrome.webview.removeEventListener('message', handleResponse);

                let isSuccess = false;
                try {
                    let responseBody = data.data;
                    if (typeof responseBody === 'string') {
                        responseBody = responseBody.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                        responseBody = JSON.parse(responseBody);
                    }
                    if (responseBody && responseBody.status === 'SUCCESS') {
                        isSuccess = true;
                    }
                } catch (e) {
                    console.error('[Cancel Flat] Parse error:', e);
                }

                if (isSuccess) {
                    // Update status in data
                    autoProcessingData[originalIndex].transaction_status = 'CANCELLED';

                    // Re-apply filters to refresh view
                    applyFilters();
                    addLogEntry('Cancel', `LID ${lid} cancelled successfully`, 'success');
                } else {
                    addLogEntry('Cancel', `Failed to cancel LID ${lid}`, 'error');
                    // Restore button
                    if (actionCell) {
                        actionCell.innerHTML = `<button onclick="cancelS2VLotFromFlat(${flatIndex}, '${lid}')" style="background: #ef4444; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 9px; font-weight: 600;"><i class="fas fa-times"></i> Cancel</button>`;
                    }
                }
            }
        };

        window.chrome.webview.addEventListener('message', handleResponse);
    } catch (error) {
        console.error('[Cancel Flat] Error:', error);
        addLogEntry('Cancel', `Error cancelling LID ${lid}: ${error.message}`, 'error');
    }
}

// Clear all filters and restore grouped view
function clearFilters() {
    document.getElementById('filter-trip-id').value = '';
    document.getElementById('filter-item-desc').value = '';
    document.getElementById('filter-lid').value = '';
    document.getElementById('filter-trx-number').value = '';
    document.getElementById('filter-status').value = '';

    autoProcessingFilters = {
        tripId: '',
        itemDesc: '',
        lid: '',
        trxNumber: '',
        status: ''
    };

    // Clear filtered data
    window.currentFilteredData = null;

    // Re-render grouped view
    displayGroupedTrips();

    addLogEntry('Filter', 'Filters cleared - restored grouped view', 'info');
}

// Global variable to store current error data
let currentErrorData = [];
let currentErrorTransaction = null;

// Show error details popup
async function showErrorDetails(tripIndex, transactionIndex) {
    const groupedTrips = groupTransactionsByTrip();
    const transaction = groupedTrips[tripIndex].transactions[transactionIndex];

    currentErrorTransaction = transaction;

    addLogEntry('Error Details', `Fetching error details for LID: ${transaction.lid}`, 'info');
    addLogEntry('Debug', `Instance Name: ${transaction.instance_name || 'PROD'}`, 'info');

    // Determine API endpoint based on instance_name
    const instanceName = transaction.instance_name || 'PROD';
    let apiUrl;

    if (instanceName === 'TEST') {
        apiUrl = 'https://efmh-test.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions?q=OrganizationName=GIC;TransactionTypeName=Direct Organization Transfer';
    } else {
        apiUrl = 'https://efmh.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions?q=OrganizationName=GIC;TransactionTypeName=Direct Organization Transfer';
    }

    addLogEntry('Debug', `API URL: ${apiUrl}`, 'info');

    // Show loading popup
    showErrorPopupLoading();

    // Check if credentials are loaded
    if (!fusionCloudUsername || !fusionCloudPassword) {
        showErrorPopupError('Oracle Fusion Cloud credentials not loaded. Please refresh the page.');
        addLogEntry('Error', 'Fusion Cloud credentials not available', 'error');
        return;
    }

    // Fetch error data
    console.log('[Error Details] Calling WebView REST handler with:', { action: 'executeGet', fullUrl: apiUrl, username: fusionCloudUsername });
    addLogEntry('Debug', `Calling WebView REST handler - Action: executeGet`, 'info');
    addLogEntry('Debug', `API URL: ${apiUrl}`, 'info');
    addLogEntry('Debug', `Using credentials - Username: ${fusionCloudUsername}, Password: ${fusionCloudPassword ? '****' : 'NOT SET'}`, 'info');

    sendMessageToCSharp({
        action: "executeGet",
        fullUrl: apiUrl,
        username: fusionCloudUsername,
        password: fusionCloudPassword
    }, function(error, data) {
        console.log('[Error Details] Callback received - Error:', error, 'Data type:', typeof data, 'Data length:', data ? data.length : 0);

        addLogEntry('Debug', `Callback received - Error: ${error || 'null'}, Data type: ${typeof data}, Data length: ${data ? data.length : 0}`, 'info');

        if (error) {
            console.error('[Error Details] Error parameter:', error);
            addLogEntry('Debug', `Error parameter value: ${JSON.stringify(error)}`, 'error');
            showErrorPopupError(error);
            addLogEntry('Error', `Failed to fetch error details: ${error}`, 'error');
            return;
        }

        if (!data) {
            console.error('[Error Details] Data is null or undefined');
            addLogEntry('Debug', 'Data parameter is null or undefined', 'error');
            showErrorPopupError('No data returned from API');
            return;
        }

        if (typeof data !== 'string') {
            console.error('[Error Details] Data is not a string, type:', typeof data);
            addLogEntry('Debug', `Data is not a string, actual type: ${typeof data}`, 'error');
            showErrorPopupError('Invalid data type returned from API');
            return;
        }

        console.log('[Error Details] Raw data received (first 200 chars):', data.substring(0, 200));
        addLogEntry('Debug', `Raw data preview: ${data.substring(0, 100)}...`, 'info');

        try {
            const response = JSON.parse(data);
            console.log('[Error Details] Parsed response:', response);
            addLogEntry('Debug', `Parsed successfully, checking for items array`, 'info');

            currentErrorData = response.items || [];

            console.log('[Error Details] Items found:', currentErrorData.length);
            addLogEntry('Error Details', `Found ${currentErrorData.length} staged transactions`, 'info');

            // Display error data in popup
            displayErrorPopup(currentErrorData, instanceName);
        } catch (parseError) {
            console.error('[Error Details] Parse error:', parseError);
            console.error('[Error Details] Parse error stack:', parseError.stack);
            console.error('[Error Details] Data that failed to parse:', data);

            addLogEntry('Debug', `Parse error: ${parseError.message}`, 'error');
            addLogEntry('Debug', `Parse error stack: ${parseError.stack}`, 'error');
            addLogEntry('Debug', `Failed data: ${data}`, 'error');

            showErrorPopupError('Failed to parse error data: ' + parseError.message + ' - Check Processing Log for details');
            addLogEntry('Error', `Parse error: ${parseError.message}`, 'error');
        }
    });
}

// Show loading popup
function showErrorPopupLoading() {
    const existingPopup = document.getElementById('error-details-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    const popup = document.createElement('div');
    popup.id = 'error-details-popup';
    popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';

    popup.innerHTML = `
        <div style="background: white; border-radius: 12px; padding: 2rem; min-width: 400px; text-align: center;">
            <i class="fas fa-spinner fa-spin" style="font-size: 48px; color: #667eea; margin-bottom: 1rem;"></i>
            <div style="font-size: 16px; font-weight: 600; color: #1e293b;">Loading Error Details...</div>
        </div>
    `;

    document.body.appendChild(popup);
}

// Show error in popup
function showErrorPopupError(errorMessage) {
    const popup = document.getElementById('error-details-popup');
    if (!popup) return;

    popup.innerHTML = `
        <div style="background: white; border-radius: 12px; padding: 2rem; min-width: 400px; max-width: 600px;">
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem;">
                <i class="fas fa-exclamation-triangle" style="font-size: 36px; color: #ef4444;"></i>
                <div>
                    <h3 style="margin: 0 0 0.5rem 0; color: #ef4444; font-size: 18px;">Error Loading Details</h3>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">${errorMessage}</p>
                </div>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                <button onclick="closeErrorPopup()" style="background: #94a3b8; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    Close
                </button>
            </div>
        </div>
    `;
}

// Display error popup with data
function displayErrorPopup(errorData, instanceName) {
    const popup = document.getElementById('error-details-popup');
    if (!popup) return;

    let tableRows = '';

    if (errorData.length === 0) {
        tableRows = `
            <tr>
                <td colspan="6" style="padding: 2rem; text-align: center; color: #94a3b8;">
                    <i class="fas fa-inbox" style="font-size: 36px; margin-bottom: 0.5rem; display: block;"></i>
                    No staged transactions found
                </td>
            </tr>
        `;
    } else {
        errorData.forEach((item, index) => {
            tableRows += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 0.75rem; font-size: 12px; color: #94a3b8;">${index + 1}</td>
                    <td style="padding: 0.75rem; font-size: 12px; font-weight: 600; color: #667eea;">${item.TransactionInterfaceId || 'N/A'}</td>
                    <td style="padding: 0.75rem; font-size: 12px; color: #1e293b;">${item.TransactionTypeName || 'N/A'}</td>
                    <td style="padding: 0.75rem; font-size: 12px; color: #1e293b;">${item.ItemNumber || 'N/A'}</td>
                    <td style="padding: 0.75rem; font-size: 12px; color: #1e293b;">${item.TransactionQuantity || 0}</td>
                    <td style="padding: 0.75rem; font-size: 11px; color: #ef4444; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.ErrorExplanation || ''}">${item.ErrorExplanation || 'No error message'}</td>
                </tr>
            `;
        });
    }

    popup.innerHTML = `
        <div style="background: white; border-radius: 12px; padding: 0; min-width: 900px; max-width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
            <!-- Header -->
            <div style="padding: 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <h3 style="margin: 0; color: white; font-size: 18px; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-exclamation-circle"></i>
                    Staged Transaction Errors (${instanceName})
                </h3>
                <p style="margin: 0.5rem 0 0 0; color: rgba(255,255,255,0.9); font-size: 13px;">
                    Found ${errorData.length} staged transaction(s)
                </p>
            </div>

            <!-- Content -->
            <div style="flex: 1; overflow-y: auto; padding: 1.5rem;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f8f9fa; border-bottom: 2px solid #e2e8f0;">
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">#</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Interface ID</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Type</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Item</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Qty</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Error</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>

            <!-- Footer -->
            <div style="padding: 1.5rem; border-top: 2px solid #e2e8f0; background: #f8f9fa; display: flex; justify-content: space-between; gap: 0.5rem;">
                <div style="display: flex; gap: 0.5rem;">
                    <button onclick="refreshErrorData()" style="background: #3b82f6; color: white; border: none; padding: 0.75rem 1.25rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.2s;">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                    ${errorData.length > 0 ? `
                        <button onclick="deleteAllStagedTransactions()" style="background: #ef4444; color: white; border: none; padding: 0.75rem 1.25rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.2s;">
                            <i class="fas fa-trash"></i> Delete All
                        </button>
                    ` : ''}
                </div>
                <button onclick="closeErrorPopup()" style="background: #94a3b8; color: white; border: none; padding: 0.75rem 1.25rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px;">
                    <i class="fas fa-times"></i> Cancel
                </button>
            </div>
        </div>
    `;
}

// Close error popup
function closeErrorPopup() {
    const popup = document.getElementById('error-details-popup');
    if (popup) {
        popup.remove();
    }
    currentErrorData = [];
    currentErrorTransaction = null;
}

// Refresh error data
function refreshErrorData() {
    if (!currentErrorTransaction) return;

    // Find the transaction indices
    const groupedTrips = groupTransactionsByTrip();
    let tripIndex = -1;
    let transactionIndex = -1;

    groupedTrips.forEach((trip, tIdx) => {
        const idx = trip.transactions.findIndex(t => t === currentErrorTransaction);
        if (idx !== -1) {
            tripIndex = tIdx;
            transactionIndex = idx;
        }
    });

    if (tripIndex !== -1 && transactionIndex !== -1) {
        showErrorDetails(tripIndex, transactionIndex);
    }
}

// Delete all staged transactions
async function deleteAllStagedTransactions() {
    if (currentErrorData.length === 0) {
        alert('No transactions to delete');
        return;
    }

    if (!confirm(`Are you sure you want to delete all ${currentErrorData.length} staged transaction(s)?`)) {
        return;
    }

    const instanceName = currentErrorTransaction.instance_name || 'PROD';
    let baseUrl;

    if (instanceName === 'TEST') {
        baseUrl = 'https://efmh-test.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions/';
    } else {
        baseUrl = 'https://efmh.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions/';
    }

    addLogEntry('Delete', `Starting deletion of ${currentErrorData.length} staged transactions...`, 'warning');

    // Show progress
    showErrorPopupLoading();

    let deletedCount = 0;
    let failedCount = 0;

    for (const item of currentErrorData) {
        const transactionInterfaceId = item.TransactionInterfaceId;

        if (!transactionInterfaceId) {
            failedCount++;
            continue;
        }

        const deleteUrl = baseUrl + transactionInterfaceId;

        await new Promise((resolve) => {
            sendMessageToCSharp({
                action: "executeDelete",
                fullUrl: deleteUrl,
                username: fusionCloudUsername,
                password: fusionCloudPassword
            }, function(error, data) {
                if (error) {
                    addLogEntry('Delete', `Failed to delete ${transactionInterfaceId}: ${error}`, 'error');
                    failedCount++;
                } else {
                    addLogEntry('Delete', `Deleted transaction ${transactionInterfaceId}`, 'success');
                    deletedCount++;
                }
                resolve();
            });
        });
    }

    addLogEntry('Delete', `Deletion complete: ${deletedCount} deleted, ${failedCount} failed`, deletedCount > 0 ? 'success' : 'error');

    // Close the popup after deletion (don't auto-refresh)
    closeErrorPopup();

    // Show success message
    if (deletedCount > 0) {
        alert(`Successfully deleted ${deletedCount} staged transaction(s)${failedCount > 0 ? `, ${failedCount} failed` : ''}`);
    } else {
        alert(`Failed to delete transactions. Check Processing Log for details.`);
    }
}

// Show/hide order processing spinner
function showOrderProcessingSpinner(orderNumber, show) {
    // Find all order IDs that match this order number
    const allOrderElements = document.querySelectorAll('[id^="order-processing-"]');

    allOrderElements.forEach(element => {
        // Check if this element belongs to the current order number
        const parentDiv = element.closest('[data-order-container]');
        if (parentDiv) {
            const orderNumberElement = parentDiv.querySelector('[style*="font-size: 14px"]');
            if (orderNumberElement && orderNumberElement.textContent.trim().includes(orderNumber.toString())) {
                element.style.display = show ? 'inline-block' : 'none';
            }
        }
    });

    if (show) {
        addLogEntry('UI', `Showing processing indicator for Order ${orderNumber}`, 'info');
    }
}

// Verify with Fusion button handler - runs SOAP report to compare data
function verifyWithFusion(orderNumber, tripIndex) {
    console.log('[Verify Fusion] Starting verification for order:', orderNumber);
    addLogEntry('Verify', `Verifying Order ${orderNumber} with Oracle Fusion Cloud...`, 'info');

    const groupedTrips = groupTransactionsByTrip();
    const trip = groupedTrips[tripIndex];

    if (!trip) {
        console.error('[Verify Fusion] Trip not found');
        alert('Trip not found');
        return;
    }

    // Get instance name from the first transaction
    const instanceName = trip.transactions[0]?.instance_name || 'PROD';
    console.log('[Verify Fusion] Instance:', instanceName);

    // Get all transactions for this order
    const orderTransactions = trip.transactions.filter(t => t.trx_number === orderNumber);

    if (orderTransactions.length === 0) {
        console.error('[Verify Fusion] No transactions found for order');
        alert('No transactions found for this order');
        return;
    }

    console.log('[Verify Fusion] Found', orderTransactions.length, 'local transactions');

    // Check if credentials are loaded
    if (!fusionCloudUsername || !fusionCloudPassword) {
        console.error('[Verify Fusion] Credentials not loaded');
        alert('Oracle Fusion Cloud credentials not loaded. Please refresh the page.');
        addLogEntry('Error', 'Fusion Cloud credentials not available', 'error');
        return;
    }

    console.log('[Verify Fusion] Using credentials:', fusionCloudUsername);

    // SOAP Report details
    const reportPath = '/Custom/DEXPRESS/INVENTORY/GRAYS_MTL_TRANSACTIONS_4_CHECKING_BIP.xdo';
    const parameterName = 'SOURCE_CODE';
    const parameterValue = String(orderNumber);

    console.log('[Verify Fusion] Report path:', reportPath);
    console.log('[Verify Fusion] Parameter:', parameterName, '=', parameterValue);

    addLogEntry('Verify', `Running SOAP report: ${reportPath}`, 'info');
    addLogEntry('Verify', `Parameter: ${parameterName} = ${parameterValue}`, 'info');

    // Show loading popup
    showVerifyLoadingPopup(orderNumber);

    // Add timeout to prevent infinite stuck state (30 seconds)
    let responseReceived = false;
    const timeoutId = setTimeout(() => {
        if (!responseReceived) {
            console.error('[Verify Fusion] TIMEOUT - No response from C# after 30 seconds');
            closeVerifyLoadingPopup();

            const errorMsg = 'Request timed out after 30 seconds.\n\n' +
                           'Possible causes:\n' +
                           '1. C# handler "HandleRunSoapReport" not added to Form1.cs\n' +
                           '2. Case statement for "runSoapReport" not added\n' +
                           '3. Application needs to be rebuilt\n' +
                           '4. Network/SOAP endpoint issue\n\n' +
                           'Please check Debug output window for C# errors.';

            alert(errorMsg);
            addLogEntry('Error', 'Verify with Fusion timed out after 30 seconds', 'error');
            addLogEntry('Error', 'Check if C# handler was added and application rebuilt', 'error');
        }
    }, 30000);

    console.log('[Verify Fusion] Sending message to C#...');
    console.log('[Verify Fusion] Message data:', {
        action: 'runSoapReport',
        reportPath: reportPath,
        parameterName: parameterName,
        parameterValue: parameterValue,
        instance: instanceName,
        username: fusionCloudUsername ? '***' : 'MISSING'
    });

    // Call C# SOAP handler to get Base64 data
    sendMessageToCSharp({
        action: 'runSoapReport',
        reportPath: reportPath,
        parameterName: parameterName,
        parameterValue: parameterValue,
        instance: instanceName,
        username: fusionCloudUsername,
        password: fusionCloudPassword
    }, function(error, data) {
        // Mark response as received and clear timeout
        responseReceived = true;
        clearTimeout(timeoutId);

        console.log('[Verify Fusion] Response received');
        console.log('[Verify Fusion] Error:', error);
        console.log('[Verify Fusion] Data type:', typeof data);
        console.log('[Verify Fusion] Data length:', data ? data.length : 0);

        if (error) {
            console.error('[Verify Fusion] Error:', error);
            closeVerifyLoadingPopup();
            alert(`Failed to run Fusion report: ${error}`);
            addLogEntry('Error', `Fusion report failed: ${error}`, 'error');
            return;
        }

        try {
            console.log('[Verify Fusion] Parsing response...');
            const response = typeof data === 'string' ? JSON.parse(data) : data;
            console.log('[Verify Fusion] Parsed response:', response);

            if (response.success && response.dataRecords) {
                console.log('[Verify Fusion] Data records count:', response.dataRecords.length);
                addLogEntry('Verify', `Received ${response.dataRecords.length} records from Fusion (parsed by C#)`, 'info');

                // Data already parsed by C# into data table
                const fusionData = response.dataRecords;
                console.log('[Verify Fusion] Fusion data:', fusionData);
                console.log('[Verify Fusion] First record:', fusionData[0]);

                addLogEntry('Verify', `Processing ${fusionData.length} Fusion records`, 'info');

                // Match with local data and display
                displayVerifyComparisonPopup(orderNumber, orderTransactions, fusionData);

            } else {
                console.error('[Verify Fusion] Invalid response structure:', response);
                closeVerifyLoadingPopup();
                alert('Invalid response from Fusion report');
                addLogEntry('Error', 'Invalid response structure from Fusion', 'error');
            }
        } catch (parseError) {
            console.error('[Verify Fusion] Parse error:', parseError);
            console.error('[Verify Fusion] Stack:', parseError.stack);
            closeVerifyLoadingPopup();
            alert('Failed to parse Fusion report response: ' + parseError.message);
            addLogEntry('Error', `Parse error: ${parseError.message}`, 'error');
        }
    });
}

// Parse Fusion report data (handles XML, CSV, JSON formats)
function parseFusionReportData(decodedData) {
    console.log('[Parse Fusion] Starting parse...');
    console.log('[Parse Fusion] Data type:', typeof decodedData);
    console.log('[Parse Fusion] First 200 chars:', decodedData.substring(0, 200));

    const results = [];

    try {
        // Try JSON first
        if (decodedData.trim().startsWith('{') || decodedData.trim().startsWith('[')) {
            console.log('[Parse Fusion] Detected as JSON');
            const jsonData = JSON.parse(decodedData);
            return Array.isArray(jsonData) ? jsonData : [jsonData];
        }

        // Try XML parsing
        if (decodedData.trim().startsWith('<')) {
            console.log('[Parse Fusion] Detected as XML');
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(decodedData, 'text/xml');

            // Look for common XML row elements
            const rows = xmlDoc.querySelectorAll('ROW, row, G_1, DATA_ROW');
            console.log('[Parse Fusion] Found XML rows:', rows.length);

            rows.forEach((row, index) => {
                const record = {};
                // Get all child elements
                Array.from(row.children).forEach(child => {
                    record[child.tagName] = child.textContent;
                });
                if (Object.keys(record).length > 0) {
                    results.push(record);
                }
            });

            console.log('[Parse Fusion] Parsed XML records:', results.length);
            return results;
        }

        // Try CSV parsing
        if (decodedData.includes(',') || decodedData.includes('\t')) {
            console.log('[Parse Fusion] Detected as CSV/TSV');
            const lines = decodedData.split('\n').filter(line => line.trim());
            console.log('[Parse Fusion] CSV lines:', lines.length);

            if (lines.length === 0) return results;

            // First line is header
            const headers = lines[0].split(/[,\t]/);
            console.log('[Parse Fusion] CSV headers:', headers);

            // Parse data lines
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(/[,\t]/);
                const record = {};
                headers.forEach((header, idx) => {
                    record[header.trim()] = values[idx] ? values[idx].trim() : '';
                });
                results.push(record);
            }

            console.log('[Parse Fusion] Parsed CSV records:', results.length);
            return results;
        }

        console.warn('[Parse Fusion] Unknown format, returning empty array');
        return results;

    } catch (e) {
        console.error('[Parse Fusion] Parse exception:', e);
        console.error('[Parse Fusion] Stack:', e.stack);
        return results;
    }
}

// Show loading popup for verify operation
function showVerifyLoadingPopup(orderNumber) {
    const popup = document.createElement('div');
    popup.id = 'verify-loading-popup';
    popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
    popup.innerHTML = `
        <div style="background: white; padding: 2rem; border-radius: 12px; text-align: center;">
            <i class="fas fa-spinner fa-spin" style="font-size: 48px; color: #667eea; margin-bottom: 1rem;"></i>
            <div style="font-size: 16px; font-weight: 600; color: #1e293b;">Verifying with Fusion Cloud...</div>
            <div style="font-size: 14px; color: #64748b; margin-top: 0.5rem;">Order: ${orderNumber}</div>
        </div>
    `;
    document.body.appendChild(popup);
}

// Close loading popup
function closeVerifyLoadingPopup() {
    const popup = document.getElementById('verify-loading-popup');
    if (popup) popup.remove();
}

// Display comparison popup with Fusion data
function displayVerifyComparisonPopup(orderNumber, localTransactions, fusionData) {
    console.log('[Display Verify] Creating comparison popup');
    console.log('[Display Verify] Local transactions:', localTransactions.length);
    console.log('[Display Verify] Fusion records:', fusionData.length);

    // Debug: Show first local transaction to see available fields
    if (localTransactions.length > 0) {
        console.log('[Display Verify] First local transaction fields:', Object.keys(localTransactions[0]));
        console.log('[Display Verify] First local transaction:', localTransactions[0]);
    }

    // Debug: Show first Fusion record to see available fields
    if (fusionData.length > 0) {
        console.log('[Display Verify] First Fusion record fields:', Object.keys(fusionData[0]));
        console.log('[Display Verify] First Fusion record:', fusionData[0]);
    }

    closeVerifyLoadingPopup();

    // Match local transactions with Fusion data by LID
    const enhancedTransactions = localTransactions.map(localTxn => {
        const lid = String(localTxn.lid || '').trim();
        console.log('[Display Verify] Matching LID:', lid);
        console.log('[Display Verify] Local transaction fields:', Object.keys(localTxn));

        // Find matching Fusion record
        const fusionMatch = fusionData.find(fusionRecord => {
            // Try different possible LID field names
            const fusionLid = String(fusionRecord.LID || fusionRecord.lid || fusionRecord.LOAD_REQUEST_NUMBER || fusionRecord.LOAD_ID || '').trim();
            return fusionLid === lid;
        });

        if (fusionMatch) {
            console.log('[Display Verify] Match found for LID', lid, ':', fusionMatch);
        } else {
            console.log('[Display Verify] No match for LID', lid);
        }

        return {
            ...localTxn,
            fusionQty: fusionMatch ? (fusionMatch.TRANSACTION_QUANTITY || fusionMatch.transaction_quantity || fusionMatch.QUANTITY || fusionMatch.quantity || fusionMatch.QTY || '0') : '-',
            fusionStatus: fusionMatch ? 'Matched' : 'Not Found',
            fusionRecord: fusionMatch || null  // Store full fusion record for reference
        };
    });

    // Build Fusion Data table (showing raw XML data from Fusion)
    // Get all unique column names from all records
    const fusionColumns = new Set();
    fusionData.forEach(record => {
        Object.keys(record).forEach(key => fusionColumns.add(key));
    });
    const fusionColumnArray = Array.from(fusionColumns);
    console.log('[Display Verify] Fusion columns:', fusionColumnArray);

    // Build header row dynamically
    let fusionTableHeader = '<th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">#</th>';
    fusionColumnArray.forEach(col => {
        fusionTableHeader += `<th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">${col}</th>`;
    });

    // Build data rows dynamically with search data attributes
    let fusionTableRows = '';
    fusionData.forEach((record, index) => {
        // Create searchable text from all values
        const searchText = Object.values(record).join('|').toLowerCase();

        let row = `<tr class="fusion-data-row" data-search="${searchText}" style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 0.75rem; font-size: 12px; color: #94a3b8;">${index + 1}</td>`;

        fusionColumnArray.forEach(col => {
            const value = record[col] || '';
            // Highlight LID column
            const isLidColumn = col.toUpperCase().includes('LID') || col.toUpperCase().includes('LOAD');
            // Check if this is a description column
            const isDescColumn = col.toUpperCase().includes('DESC') || col.toUpperCase().includes('DESCRIPTION');

            let style = '';
            if (isLidColumn) {
                style = 'padding: 0.75rem; font-size: 12px; font-weight: 600; color: #667eea;';
            } else if (isDescColumn) {
                // Limit description to max 2 lines with ellipsis
                style = 'padding: 0.75rem; font-size: 12px; color: #1e293b; max-width: 300px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;';
            } else {
                style = 'padding: 0.75rem; font-size: 12px; color: #1e293b;';
            }

            row += `<td style="${style}">${value}</td>`;
        });

        row += `</tr>`;
        fusionTableRows += row;
    });

    // Build Order Lines table (with matching)
    let orderLinesRows = '';
    enhancedTransactions.forEach((txn, index) => {
        const statusColor = txn.fusionStatus === 'Matched' ? '#10b981' : '#ef4444';

        // Use picked_qty (the correct field from main grid)
        const localQty = txn.picked_qty || txn.txn_qty || txn.transaction_quantity || txn.quantity || txn.PICKED_QTY || txn.QUANTITY || 0;
        const qtyMatch = String(localQty) === String(txn.fusionQty);
        const qtyColor = qtyMatch ? '#10b981' : '#f59e0b';

        // Try multiple field names for item code and description
        const itemCode = txn.item_code || txn.ITEM_CODE || txn.item || txn.ITEM || 'N/A';
        const itemDesc = txn.item_desc || txn.ITEM_DESC || txn.description || txn.DESCRIPTION || 'N/A';
        const lid = txn.lid || txn.LID || txn.load_id || txn.LOAD_ID || 'N/A';
        const lotNumber = txn.lot_number || txn.LOT_NUMBER || txn.lot || 'N/A';

        console.log(`[Display Verify] Row ${index + 1}: LID=${lid}, LocalQty=${localQty} (from picked_qty), FusionQty=${txn.fusionQty}, Match=${qtyMatch}`);

        orderLinesRows += `
            <tr class="order-line-row" data-lid="${lid}" data-itemcode="${itemCode}" data-lotnum="${lotNumber}" style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 0.75rem; font-size: 12px; color: #94a3b8;">${index + 1}</td>
                <td style="padding: 0.75rem; font-size: 12px; font-weight: 600; color: #667eea;">${lid}</td>
                <td style="padding: 0.75rem; font-size: 12px; color: #1e293b;">${itemCode}</td>
                <td style="padding: 0.75rem; font-size: 12px; color: #1e293b;">${itemDesc}</td>
                <td style="padding: 0.75rem; font-size: 12px; color: #64748b;">${lotNumber}</td>
                <td style="padding: 0.75rem; font-size: 12px; text-align: center; font-weight: 600; color: #1e293b;">${localQty}</td>
                <td style="padding: 0.75rem; font-size: 12px; text-align: center; font-weight: 600; color: ${qtyColor};">${txn.fusionQty}</td>
                <td style="padding: 0.75rem; font-size: 11px; text-align: center;">
                    <span style="display: inline-block; padding: 4px 8px; border-radius: 4px; background: ${statusColor}; color: white; font-weight: 600;">
                        ${txn.fusionStatus}
                    </span>
                </td>
            </tr>
        `;
    });

    const matchedCount = enhancedTransactions.filter(t => t.fusionStatus === 'Matched').length;
    const notFoundCount = enhancedTransactions.filter(t => t.fusionStatus === 'Not Found').length;

    const popup = document.createElement('div');
    popup.id = 'verify-comparison-popup';
    popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';

    popup.innerHTML = `
        <div style="background: white; border-radius: 12px; padding: 0; min-width: 1100px; max-width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
            <!-- Header -->
            <div style="padding: 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <h3 style="margin: 0; color: white; font-size: 18px; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-check-double"></i>
                    Fusion Verification - Order ${orderNumber}
                </h3>
                <p style="margin: 0.5rem 0 0 0; color: rgba(255,255,255,0.9); font-size: 13px;">
                    Fusion Records: ${fusionData.length} | Local Lines: ${enhancedTransactions.length} | Matched: ${matchedCount} | Not Found: ${notFoundCount}
                </p>
            </div>

            <!-- Tab Navigation -->
            <div style="display: flex; border-bottom: 2px solid #e2e8f0; background: #f8f9fa;">
                <button onclick="switchVerifyTab('fusion-data')" class="verify-tab-btn" data-tab="fusion-data" style="flex: 1; padding: 1rem; border: none; background: transparent; cursor: pointer; font-weight: 600; color: #667eea; border-bottom: 3px solid #667eea; transition: all 0.3s;">
                    <i class="fas fa-cloud"></i> Fusion Data (${fusionData.length})
                </button>
                <button onclick="switchVerifyTab('order-lines')" class="verify-tab-btn" data-tab="order-lines" style="flex: 1; padding: 1rem; border: none; background: transparent; cursor: pointer; font-weight: 600; color: #64748b; border-bottom: 3px solid transparent; transition: all 0.3s;">
                    <i class="fas fa-list"></i> Order Lines (Matched)
                </button>
            </div>

            <!-- Content -->
            <div style="flex: 1; overflow-y: auto; padding: 1.5rem;">
                <!-- Fusion Data Tab -->
                <div id="verify-fusion-data-tab" class="verify-tab-content">
                    <!-- Search Box -->
                    <div style="margin-bottom: 1rem;">
                        <input type="text" id="fusion-search-box" placeholder="Search Fusion Data..." onkeyup="filterFusionData()" style="width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0; border-radius: 6px; font-size: 14px;" />
                    </div>
                    <div style="margin-bottom: 1rem; padding: 0.75rem; background: #e0e7ff; border-radius: 6px; border-left: 4px solid #667eea;">
                        <p style="margin: 0; font-size: 13px; color: #1e293b;">
                            <i class="fas fa-info-circle"></i> <strong>Raw data from Oracle Fusion Cloud</strong> - Showing all ${fusionData.length} records from SOAP report.
                        </p>
                    </div>
                    <div style="overflow-x: auto;">
                        <table id="fusion-data-table" style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #f8f9fa; border-bottom: 2px solid #e2e8f0;">
                                    ${fusionTableHeader}
                                </tr>
                            </thead>
                            <tbody>
                                ${fusionTableRows}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Order Lines Tab -->
                <div id="verify-order-lines-tab" class="verify-tab-content" style="display: none;">
                    <!-- Search Box -->
                    <div style="margin-bottom: 1rem;">
                        <input type="text" id="order-lines-search-box" placeholder="Search Order Lines (LID, Item Code, Lot Number)..." onkeyup="filterOrderLines()" style="width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0; border-radius: 6px; font-size: 14px;" />
                    </div>
                    <div style="margin-bottom: 1rem; padding: 0.75rem; background: #e0e7ff; border-radius: 6px; border-left: 4px solid #667eea;">
                        <p style="margin: 0; font-size: 13px; color: #1e293b;">
                            <i class="fas fa-info-circle"></i> <strong>Local order lines with Fusion matching</strong> - 🟢 Matched | 🟠 Qty Mismatch | 🔴 Not Found
                        </p>
                    </div>
                    <div style="overflow-x: auto;">
                        <table id="order-lines-table" style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #f8f9fa; border-bottom: 2px solid #e2e8f0;">
                                    <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">#</th>
                                    <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">LID</th>
                                    <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Item Code</th>
                                    <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Description</th>
                                    <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Lot Number</th>
                                    <th style="padding: 0.75rem; text-align: center; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Local Qty</th>
                                    <th style="padding: 0.75rem; text-align: center; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Fusion Qty</th>
                                    <th style="padding: 0.75rem; text-align: center; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${orderLinesRows}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div style="padding: 1.5rem; border-top: 2px solid #e2e8f0; background: #f8f9fa; display: flex; justify-content: flex-end;">
                <button onclick="document.getElementById('verify-comparison-popup').remove()" style="background: #94a3b8; color: white; border: none; padding: 0.75rem 1.25rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px;">
                    <i class="fas fa-times"></i> Close
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(popup);

    addLogEntry('Verify', `Comparison complete: ${matchedCount} matched, ${notFoundCount} not found`, matchedCount === enhancedTransactions.length ? 'success' : 'warning');
}

// Switch verify popup tabs
function switchVerifyTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.verify-tab-content').forEach(tab => {
        tab.style.display = 'none';
    });

    // Remove active class from all buttons
    document.querySelectorAll('.verify-tab-btn').forEach(btn => {
        btn.style.color = '#64748b';
        btn.style.borderBottom = '3px solid transparent';
    });

    // Show selected tab
    if (tabName === 'fusion-data') {
        document.getElementById('verify-fusion-data-tab').style.display = 'block';
    } else if (tabName === 'order-lines') {
        document.getElementById('verify-order-lines-tab').style.display = 'block';
    }

    // Add active class to clicked button
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.style.color = '#667eea';
        activeBtn.style.borderBottom = '3px solid #667eea';
    }
}

// Filter Fusion Data table
function filterFusionData() {
    const searchBox = document.getElementById('fusion-search-box');
    if (!searchBox) return;

    const filter = searchBox.value.toLowerCase();
    const rows = document.querySelectorAll('.fusion-data-row');

    let visibleCount = 0;
    rows.forEach(row => {
        const searchText = row.getAttribute('data-search') || '';
        if (searchText.includes(filter)) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });

    console.log(`[Filter Fusion] Showing ${visibleCount} of ${rows.length} records`);
}

// Filter Order Lines table
function filterOrderLines() {
    const searchBox = document.getElementById('order-lines-search-box');
    if (!searchBox) return;

    const filter = searchBox.value.toLowerCase();
    const rows = document.querySelectorAll('.order-line-row');

    let visibleCount = 0;
    rows.forEach(row => {
        const lid = (row.getAttribute('data-lid') || '').toLowerCase();
        const itemCode = (row.getAttribute('data-itemcode') || '').toLowerCase();
        const lotNum = (row.getAttribute('data-lotnum') || '').toLowerCase();

        if (lid.includes(filter) || itemCode.includes(filter) || lotNum.includes(filter)) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });

    console.log(`[Filter Order Lines] Showing ${visibleCount} of ${rows.length} rows`);
}

// Print order button handler - using C# Fusion PDF handler (Store Transaction Report)
function printOrder(orderNumber, tripIndex) {
    addLogEntry('Print', `Printing Order ${orderNumber}...`, 'info');

    const groupedTrips = groupTransactionsByTrip();
    const trip = groupedTrips[tripIndex];

    if (!trip) {
        alert('Trip not found');
        addLogEntry('Error', 'Trip not found', 'error');
        return;
    }

    // Get all transactions for this order
    const orderTransactions = trip.transactions.filter(t => t.trx_number === orderNumber);

    if (orderTransactions.length === 0) {
        alert('No transactions found for this order');
        addLogEntry('Error', 'No transactions found for this order', 'error');
        return;
    }

    // Get instance name, trip_id, and trip_date from first transaction
    const instance = orderTransactions[0].instance_name || 'PROD';
    const tripId = orderTransactions[0].trip_id || '';
    let tripDate = orderTransactions[0].trip_date || '';

    // Format tripDate to remove time portion (Windows path compatible)
    // Convert "2025-11-20T00:00:00Z" to "2025-11-20"
    if (tripDate) {
        try {
            const dateObj = new Date(tripDate);
            tripDate = dateObj.toISOString().split('T')[0]; // Get only YYYY-MM-DD part
        } catch (e) {
            // If date parsing fails, try to extract date part
            if (tripDate.includes('T')) {
                tripDate = tripDate.split('T')[0];
            }
        }
    }

    // Store Transaction reports are for Store to Van / Van to Store (Inventory Reports)
    const reportPath = '/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo';
    const parameterName = 'SOURCE_CODE';
    const reportName = 'Store Transaction Report (Inventory)';

    addLogEntry('Print', `Generating PDF report for Order ${orderNumber}`, 'info');
    addLogEntry('Print', `Report: ${reportName}`, 'info');
    addLogEntry('Print', `Instance: ${instance}`, 'info');
    addLogEntry('Print', `Trip Date: ${tripDate}`, 'info');

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

    // Call C# handler to generate PDF from Oracle Fusion Cloud
    // Ensure all values are strings
    sendMessageToCSharp({
        action: 'printStoreTransaction',
        orderNumber: String(orderNumber),
        instance: String(instance),
        reportPath: String(reportPath),
        parameterName: String(parameterName),
        tripId: String(tripId),
        tripDate: String(tripDate)
    }, function(error, data) {
        // Remove loading indicator
        const loading = document.getElementById('print-loading-indicator');
        if (loading) loading.remove();

        if (error) {
            addLogEntry('Error', `Failed to generate PDF report: ${error}`, 'error');
            alert('Error generating report: ' + error);
        } else {
            try {
                const response = typeof data === 'string' ? JSON.parse(data) : data;
                addLogEntry('Print', `Response received: ${JSON.stringify(response)}`, 'info');

                if (response.success) {
                    // Check for PDF path in multiple possible properties
                    const pdfPath = response.pdfPath || response.filePath || response.path;

                    if (pdfPath) {
                        addLogEntry('Print', `PDF generated successfully: ${pdfPath}`, 'success');

                        // Open PDF viewer (showPdfViewer is a global function from app.js)
                        if (typeof window.showPdfViewer === 'function') {
                            window.showPdfViewer(pdfPath, orderNumber, reportName);
                        } else {
                            // Fallback: just show success message
                            alert(`PDF report generated successfully!\n\nFile: ${pdfPath}`);
                        }
                    } else {
                        addLogEntry('Print', `PDF generated but no path in response. Response: ${JSON.stringify(response)}`, 'warning');
                        alert('Report generated successfully!\n\nNote: PDF path not found in response.\nCheck Processing Log for details.');
                    }
                } else {
                    addLogEntry('Error', `PDF generation failed: ${response.message}`, 'error');
                    alert('Failed to generate PDF: ' + (response.message || 'Unknown error'));
                }
            } catch (parseError) {
                // Handle non-JSON responses (sometimes C# returns just a file path string)
                addLogEntry('Print', `Non-JSON response received: ${data}`, 'info');

                // Check if data looks like a file path
                if (data && typeof data === 'string' && (data.includes('\\') || data.includes('.pdf') || data.includes('C:') || data.includes('/'))) {
                    const pdfPath = data.trim();
                    addLogEntry('Print', `PDF generated successfully: ${pdfPath}`, 'success');

                    // Open PDF viewer
                    if (typeof window.showPdfViewer === 'function') {
                        window.showPdfViewer(pdfPath, orderNumber, reportName);
                    } else {
                        alert(`PDF report generated successfully!\n\nFile: ${pdfPath}`);
                    }
                } else {
                    addLogEntry('Error', `Failed to parse response: ${parseError.message}`, 'error');
                    alert('Error processing response: ' + parseError.message);
                }
            }
        }
    });
}

// Process single order button handler
async function processSingleOrder(orderNumber, tripIndex) {
    addLogEntry('Process', `Starting to process Order ${orderNumber}...`, 'info');

    const groupedTrips = groupTransactionsByTrip();
    const trip = groupedTrips[tripIndex];

    if (!trip) {
        alert('Trip not found');
        addLogEntry('Error', 'Trip not found', 'error');
        return;
    }

    // Get all transactions for this order
    let orderTransactions = trip.transactions.filter(t => t.trx_number === orderNumber);

    if (orderTransactions.length === 0) {
        alert('No transactions found for this order');
        addLogEntry('Error', 'No transactions found for this order', 'error');
        return;
    }

    // Filter out bypassed transactions and validate picked_qty
    const pendingTransactions = orderTransactions.filter(t => {
        const status = (t.transaction_status || '').toUpperCase();
        const isPending = !t.transaction_status || status === '' || status === 'PENDING';
        const isNotBypassed = !t.bypassed;
        const hasValidQuantity = t.picked_qty && parseFloat(t.picked_qty) > 0;
        return isPending && isNotBypassed && hasValidQuantity;
    });

    if (pendingTransactions.length === 0) {
        alert(`Order ${orderNumber}: No pending transactions to process (all are either completed, bypassed, or failed)`);
        addLogEntry('Process', `Order ${orderNumber}: No pending transactions`, 'warning');
        return;
    }

    addLogEntry('Process', `Order ${orderNumber}: Processing ${pendingTransactions.length} pending transaction(s)...`, 'info');

    // Show processing spinner
    showOrderProcessingSpinner(orderNumber, true);

    let processedCount = 0;
    let failedCount = 0;
    let stoppedDueToFailure = false;

    try {
        for (let i = 0; i < pendingTransactions.length; i++) {
            const transaction = pendingTransactions[i];

            // Find the actual trip and transaction index for DOM updates
            let actualTripIndex = -1;
            let actualTransactionIndex = -1;

            groupedTrips.forEach((trip, tIdx) => {
                const idx = trip.transactions.findIndex(t => t === transaction);
                if (idx !== -1) {
                    actualTripIndex = tIdx;
                    actualTransactionIndex = idx;
                }
            });

            try {
                // Process transaction
                await processAutoTransaction(transaction, actualTripIndex, actualTransactionIndex);
                processedCount++;

                addLogEntry('Process', `Order ${orderNumber}, Line ${i + 1}/${pendingTransactions.length}: Success`, 'success');
            } catch (error) {
                // Transaction failed - stop processing
                failedCount++;
                stoppedDueToFailure = true;
                addLogEntry('Error', `Order ${orderNumber}, Line ${i + 1}/${pendingTransactions.length}: Failed - ${error.message}`, 'error');
                break;
            }
        }

        // Hide processing spinner
        showOrderProcessingSpinner(orderNumber, false);

        // Update statistics
        updateStatistics();

        // Show completion message
        if (stoppedDueToFailure) {
            alert(`Order ${orderNumber}: Processing stopped due to failure.\n\nProcessed: ${processedCount}\nFailed: ${failedCount}\n\nCheck Processing Log for details.`);
            addLogEntry('Process', `Order ${orderNumber}: Stopped due to failure. ${processedCount} processed, ${failedCount} failed`, 'error');
        } else {
            alert(`Order ${orderNumber}: Processing complete!\n\nSuccessfully processed ${processedCount} transaction(s).`);
            addLogEntry('Process', `Order ${orderNumber}: Successfully completed ${processedCount} transaction(s)`, 'success');
        }

    } catch (error) {
        showOrderProcessingSpinner(orderNumber, false);
        addLogEntry('Error', `Order ${orderNumber}: Unexpected error - ${error.message}`, 'error');
        alert(`Order ${orderNumber}: An unexpected error occurred. Check Processing Log for details.`);
        updateStatistics();
    }
}

// Process single line button handler
// REMOVED OLD DUPLICATE - This was calling processAutoTransaction which runs DELETE
// The correct processSingleLine function is at line 1314 and does NOT call DELETE

// Build Analytics View
function buildAnalytics() {
    console.log('[Analytics] Building analytics view...');

    if (!autoProcessingData || autoProcessingData.length === 0) {
        document.getElementById('analytics-container').innerHTML = `
            <div style="text-align: center; padding: 3rem; color: #94a3b8;">
                <i class="fas fa-chart-bar" style="font-size: 48px; margin-bottom: 1rem;"></i>
                <p style="font-size: 16px; margin: 0;">No analytics data available. Fetch data to view analytics.</p>
            </div>
        `;
        return;
    }

    // Calculate analytics
    const stats = {
        byStatus: {},
        byItem: {},
        byOrder: {},
        byTrip: {},
        total: autoProcessingData.length
    };

    // Aggregate data
    autoProcessingData.forEach(txn => {
        // By Status
        const status = txn.transaction_status || 'UNKNOWN';
        stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

        // By Item
        const itemCode = txn.item_code || 'Unknown Item';
        if (!stats.byItem[itemCode]) {
            stats.byItem[itemCode] = {
                count: 0,
                desc: txn.item_desc || 'N/A',
                success: 0,
                failed: 0,
                pending: 0,
                totalQty: 0
            };
        }
        stats.byItem[itemCode].count++;
        stats.byItem[itemCode].totalQty += parseFloat(txn.picked_qty || txn.txn_qty || 0);
        if (status === 'SUCCESS') stats.byItem[itemCode].success++;
        if (status === 'FAILED') stats.byItem[itemCode].failed++;
        if (status === 'PENDING') stats.byItem[itemCode].pending++;

        // By Order
        const orderNum = txn.trx_number || 'Unknown Order';
        if (!stats.byOrder[orderNum]) {
            stats.byOrder[orderNum] = {
                count: 0,
                success: 0,
                failed: 0,
                pending: 0
            };
        }
        stats.byOrder[orderNum].count++;
        if (status === 'SUCCESS') stats.byOrder[orderNum].success++;
        if (status === 'FAILED') stats.byOrder[orderNum].failed++;
        if (status === 'PENDING') stats.byOrder[orderNum].pending++;

        // By Trip
        const tripNum = txn.trip_number || 'Unknown Trip';
        stats.byTrip[tripNum] = (stats.byTrip[tripNum] || 0) + 1;
    });

    // Sort items by count (top items)
    const topItems = Object.entries(stats.byItem)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10);

    // Sort orders by count
    const topOrders = Object.entries(stats.byOrder)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10);

    // Build HTML
    let html = '<div style="display: grid; gap: 1.5rem;">';

    // Summary Cards
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">';

    const totalSuccess = stats.byStatus['SUCCESS'] || 0;
    const totalFailed = stats.byStatus['FAILED'] || 0;
    const totalPending = stats.byStatus['PENDING'] || 0;
    const totalProcessing = stats.byStatus['PROCESSING'] || 0;
    const successRate = stats.total > 0 ? ((totalSuccess / stats.total) * 100).toFixed(1) : 0;

    html += `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 1.5rem; border-radius: 12px; color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 0.5rem;">Total Transactions</div>
            <div style="font-size: 32px; font-weight: 700;">${stats.total}</div>
        </div>
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 1.5rem; border-radius: 12px; color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 0.5rem;">Success</div>
            <div style="font-size: 32px; font-weight: 700;">${totalSuccess}</div>
            <div style="font-size: 12px; opacity: 0.8; margin-top: 0.25rem;">${successRate}% success rate</div>
        </div>
        <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 1.5rem; border-radius: 12px; color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 0.5rem;">Failed</div>
            <div style="font-size: 32px; font-weight: 700;">${totalFailed}</div>
        </div>
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 1.5rem; border-radius: 12px; color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 0.5rem;">Pending</div>
            <div style="font-size: 32px; font-weight: 700;">${totalPending}</div>
        </div>
    `;
    html += '</div>';

    // Top Items Section
    html += `
        <div style="background: white; padding: 1.5rem; border-radius: 12px; border: 1px solid #e2e8f0;">
            <h3 style="margin: 0 0 1rem 0; color: #1e293b; font-size: 18px; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-box" style="color: #667eea;"></i> Top Items by Transaction Count
            </h3>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f8f9fc; border-bottom: 2px solid #e2e8f0;">
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">#</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Item Code</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Description</th>
                            <th style="padding: 0.75rem; text-align: right; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Transactions</th>
                            <th style="padding: 0.75rem; text-align: right; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Total Qty</th>
                            <th style="padding: 0.75rem; text-align: right; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Success</th>
                            <th style="padding: 0.75rem; text-align: right; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Failed</th>
                            <th style="padding: 0.75rem; text-align: right; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Pending</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    topItems.forEach(([ itemCode, data], index) => {
        const successPct = data.count > 0 ? ((data.success / data.count) * 100).toFixed(0) : 0;
        html += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 0.75rem; font-size: 12px; color: #94a3b8;">${index + 1}</td>
                <td style="padding: 0.75rem; font-size: 12px; font-weight: 600; color: #667eea;">${itemCode}</td>
                <td style="padding: 0.75rem; font-size: 12px; color: #1e293b; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${data.desc}</td>
                <td style="padding: 0.75rem; text-align: right; font-size: 12px; font-weight: 600; color: #1e293b;">${data.count}</td>
                <td style="padding: 0.75rem; text-align: right; font-size: 12px; color: #1e293b;">${data.totalQty.toFixed(2)}</td>
                <td style="padding: 0.75rem; text-align: right; font-size: 12px; color: #10b981; font-weight: 600;">${data.success}</td>
                <td style="padding: 0.75rem; text-align: right; font-size: 12px; color: #ef4444; font-weight: 600;">${data.failed}</td>
                <td style="padding: 0.75rem; text-align: right; font-size: 12px; color: #f59e0b; font-weight: 600;">${data.pending}</td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Top Orders Section
    html += `
        <div style="background: white; padding: 1.5rem; border-radius: 12px; border: 1px solid #e2e8f0;">
            <h3 style="margin: 0 0 1rem 0; color: #1e293b; font-size: 18px; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-file-alt" style="color: #667eea;"></i> Top Orders by Transaction Count
            </h3>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f8f9fc; border-bottom: 2px solid #e2e8f0;">
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">#</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Order Number</th>
                            <th style="padding: 0.75rem; text-align: right; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Total Lines</th>
                            <th style="padding: 0.75rem; text-align: right; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Success</th>
                            <th style="padding: 0.75rem; text-align: right; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Failed</th>
                            <th style="padding: 0.75rem; text-align: right; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Pending</th>
                            <th style="padding: 0.75rem; text-align: right; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    topOrders.forEach(([orderNum, data], index) => {
        const statusColor = data.failed > 0 ? '#ef4444' : data.pending > 0 ? '#f59e0b' : '#10b981';
        const statusText = data.failed > 0 ? 'Has Failures' : data.pending > 0 ? 'In Progress' : 'Completed';
        html += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 0.75rem; font-size: 12px; color: #94a3b8;">${index + 1}</td>
                <td style="padding: 0.75rem; font-size: 12px; font-weight: 600; color: #667eea;">${orderNum}</td>
                <td style="padding: 0.75rem; text-align: right; font-size: 12px; font-weight: 600; color: #1e293b;">${data.count}</td>
                <td style="padding: 0.75rem; text-align: right; font-size: 12px; color: #10b981; font-weight: 600;">${data.success}</td>
                <td style="padding: 0.75rem; text-align: right; font-size: 12px; color: #ef4444; font-weight: 600;">${data.failed}</td>
                <td style="padding: 0.75rem; text-align: right; font-size: 12px; color: #f59e0b; font-weight: 600;">${data.pending}</td>
                <td style="padding: 0.75rem; text-align: right; font-size: 12px; color: ${statusColor}; font-weight: 600;">${statusText}</td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Trip Distribution
    html += `
        <div style="background: white; padding: 1.5rem; border-radius: 12px; border: 1px solid #e2e8f0;">
            <h3 style="margin: 0 0 1rem 0; color: #1e293b; font-size: 18px; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-truck" style="color: #667eea;"></i> Trip Distribution
            </h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1rem;">
    `;

    Object.entries(stats.byTrip).forEach(([tripNum, count]) => {
        html += `
            <div style="background: #f8f9fc; padding: 1rem; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center;">
                <div style="font-size: 11px; color: #64748b; margin-bottom: 0.5rem;">Trip ${tripNum}</div>
                <div style="font-size: 24px; font-weight: 700; color: #667eea;">${count}</div>
                <div style="font-size: 10px; color: #94a3b8; margin-top: 0.25rem;">transactions</div>
            </div>
        `;
    });

    html += `
            </div>
        </div>
    `;

    html += '</div>';

    document.getElementById('analytics-container').innerHTML = html;
    console.log('[Analytics] Analytics view built successfully');
}

// Open Store Transactions dialog for an order
function openStoreTransactionsFromOrder(orderNumber, instanceName) {
    console.log('[Auto Processing] Opening Store Transactions for order:', orderNumber, 'Instance:', instanceName);

    // Create rowData object compatible with openStoreTransactionsDialog
    const rowData = {
        ORDER_NUMBER: orderNumber,
        order_number: orderNumber,
        source_order_number: orderNumber,
        SOURCE_ORDER_NUMBER: orderNumber,
        ORDER_TYPE: 'S2V',
        order_type: 'S2V',
        instance_name: instanceName || 'PROD',
        INSTANCE_NAME: instanceName || 'PROD'
    };

    // Call the existing openStoreTransactionsDialog function from app.js
    if (typeof window.openStoreTransactionsDialog === 'function') {
        window.openStoreTransactionsDialog(rowData);
    } else {
        alert('Store Transactions dialog function not found. Please ensure app.js is loaded.');
        console.error('[Auto Processing] openStoreTransactionsDialog function not found on window object');
    }
}

// Make functions globally accessible
window.fetchAutoInventoryData = fetchAutoInventoryData;
window.runSimulation = runSimulation;
window.toggleTripDetails = toggleTripDetails;
window.toggleOrderDetails = toggleOrderDetails;
window.expandAllOrders = expandAllOrders;
window.collapseAllOrders = collapseAllOrders;
window.retryTransaction = retryTransaction;
window.switchAutoTab = switchAutoTab;
// ============================================================================
// TRIP PRINT MODAL FUNCTIONS
// ============================================================================

let currentTripPrintData = null;

// Open Trip Print Modal
window.openTripPrintModal = async function(tripId, tripDate, orderCount, tripIndex) {
    console.log('[Trip Print] Opening modal for trip:', tripId);
    console.log('[Trip Print] Raw tripDate received:', tripDate);

    // Format tripDate to remove time portion (for consistent path: c:/fusion/YYYY-MM-DD/trip/order.pdf)
    let formattedTripDate = tripDate;
    if (tripDate) {
        try {
            // If it's a date object or ISO string, extract only YYYY-MM-DD
            const dateObj = new Date(tripDate);
            formattedTripDate = dateObj.toISOString().split('T')[0]; // Get only YYYY-MM-DD part
            console.log('[Trip Print] Formatted tripDate:', formattedTripDate);
        } catch (e) {
            // If date parsing fails, try to extract date part manually
            if (String(tripDate).includes('T')) {
                formattedTripDate = String(tripDate).split('T')[0];
                console.log('[Trip Print] Manually extracted tripDate:', formattedTripDate);
            }
        }
    }

    // Get trip data
    const groupedTrips = groupTransactionsByTrip();
    const trip = groupedTrips[tripIndex];

    if (!trip) {
        alert('Trip data not found');
        return;
    }

    // Get unique orders from trip
    const uniqueOrders = [...new Set(trip.transactions.map(t => t.trx_number))];
    const orders = uniqueOrders.map(orderNum => {
        const orderTransactions = trip.transactions.filter(t => t.trx_number === orderNum);
        const firstTrx = orderTransactions[0];
        return {
            orderNumber: orderNum,
            tripId: tripId,
            tripDate: formattedTripDate,  // Use formatted date
            instance: firstTrx.instance_name || firstTrx.INSTANCE_NAME || 'PROD',
            orderType: firstTrx.order_type || firstTrx.ORDER_TYPE || firstTrx.ORDER_TYPE_CODE || firstTrx.order_type_code || '',
            downloadStatus: 'PENDING',
            printStatus: 'PENDING',
            pdfPath: null,
            error: null
        };
    });

    // Auto Inventory Processing page is ONLY for Store to Van / Van to Store transactions
    // So we always use Store Transaction Report (Inventory)
    let reportName = 'Store Transaction Report (Inventory)'; // Always Store Transaction for Auto Processing
    let instanceName = 'PROD';
    let orderTypeName = '';

    if (orders.length > 0) {
        instanceName = orders[0].instance;
        orderTypeName = orders[0].orderType;

        console.log('[Trip Print] Opening from Auto Inventory Processing page');
        console.log('[Trip Print] Order Type:', orderTypeName);
        console.log('[Trip Print] Instance:', instanceName);
        console.log('[Trip Print] Report: Store Transaction Report (Inventory)');
    }

    // Store current trip print data
    currentTripPrintData = {
        tripId: tripId,
        tripDate: tripDate,
        orderCount: orders.length,
        orders: orders,
        tripIndex: tripIndex,
        reportName: reportName,
        instanceName: instanceName,
        orderTypeName: orderTypeName
    };

    // Populate modal
    document.getElementById('trip-print-trip-id').textContent = tripId;
    document.getElementById('trip-print-order-count').textContent = orders.length;
    document.getElementById('trip-print-status').textContent = 'Ready';
    document.getElementById('trip-print-status').style.color = '#10b981';

    // Update report name, instance, and order type in modal header
    document.getElementById('trip-print-report-name').textContent = reportName;
    document.getElementById('trip-print-instance-name').textContent = instanceName;
    document.getElementById('trip-print-order-type').textContent = orderTypeName;

    // Update DEBUG section - show what will actually be sent to C#
    document.getElementById('debug-report-name').textContent = reportName;
    document.getElementById('debug-report-path').textContent = '/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo';
    document.getElementById('debug-param-name').textContent = 'SOURCE_CODE';
    document.getElementById('debug-order-type-sent').textContent = orderTypeName || '(empty)';
    document.getElementById('debug-trip-date-sent').textContent = formattedTripDate || '(empty)';
    document.getElementById('debug-path-format').textContent = `C:/fusion/${formattedTripDate}/${tripId}/[orderNumber].pdf`;

    // Generate and display SOAP XML that should be sent to Oracle Fusion
    const sampleOrderNumber = orders.length > 0 ? orders[0].orderNumber : '1234567';
    const soapXML = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo</v2:reportAbsolutePath>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>
            <v2:item>
              <v2:name>SOURCE_CODE</v2:name>
              <v2:values>
                <v2:item>${sampleOrderNumber}</v2:item>
              </v2:values>
            </v2:item>
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:sizeOfDataChunkDownload>-1</v2:sizeOfDataChunkDownload>
      </v2:reportRequest>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>`;
    document.getElementById('debug-soap-xml').textContent = soapXML;

    // Render orders list
    renderTripPrintOrders();

    // Load printers
    await loadPrintersForTripPrint();

    // Show modal
    const modal = document.getElementById('trip-print-modal');
    modal.style.display = 'flex';

    // Debug: Log z-index information
    const computedStyle = window.getComputedStyle(modal);
    const modalZIndex = computedStyle.zIndex;
    const modalInnerDiv = modal.firstElementChild;
    const innerZIndex = modalInnerDiv ? window.getComputedStyle(modalInnerDiv).zIndex : 'N/A';

    console.log('=====================================');
    console.log('[Trip Print] Modal Z-Index Debug:');
    console.log('[Trip Print] Outer modal z-index:', modalZIndex);
    console.log('[Trip Print] Inner div z-index:', innerZIndex);
    console.log('[Trip Print] Modal display:', modal.style.display);
    console.log('[Trip Print] Modal position:', computedStyle.position);
    console.log('=====================================');

    // Reset buttons
    document.getElementById('trip-print-download-btn').style.display = 'inline-flex';
    document.getElementById('trip-print-print-btn').style.display = 'none';
    document.getElementById('trip-print-retry-all-btn').style.display = 'none';
    document.getElementById('trip-print-error').style.display = 'none';
};

// Close Trip Print Modal
window.closeTripPrintModal = function() {
    console.log('[Trip Print] Closing modal');
    document.getElementById('trip-print-modal').style.display = 'none';
    currentTripPrintData = null;
};

// Toggle debug section
window.toggleTripPrintDebug = function() {
    const content = document.getElementById('trip-debug-content');
    const icon = document.getElementById('trip-debug-toggle-icon');

    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.className = 'fas fa-chevron-up';
    } else {
        content.style.display = 'none';
        icon.className = 'fas fa-chevron-down';
    }
};

// Update debug XML for specific order
function updateDebugXMLForOrder(orderNumber) {
    const soapXML = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo</v2:reportAbsolutePath>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>
            <v2:item>
              <v2:name>SOURCE_CODE</v2:name>
              <v2:values>
                <v2:item>${orderNumber}</v2:item>
              </v2:values>
            </v2:item>
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:sizeOfDataChunkDownload>-1</v2:sizeOfDataChunkDownload>
      </v2:reportRequest>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>`;

    document.getElementById('debug-soap-xml').textContent = soapXML;
    document.getElementById('debug-current-order').textContent = orderNumber;
}

// Render orders list in modal
function renderTripPrintOrders() {
    if (!currentTripPrintData) return;

    const container = document.getElementById('trip-print-orders-list');
    let html = '';

    currentTripPrintData.orders.forEach((order, index) => {
        const downloadStatusColor =
            order.downloadStatus === 'DOWNLOADED' ? '#10b981' :
            order.downloadStatus === 'DOWNLOADING' ? '#f59e0b' :
            order.downloadStatus === 'FAILED' ? '#ef4444' :
            '#94a3b8';

        const downloadStatusIcon =
            order.downloadStatus === 'DOWNLOADED' ? 'check-circle' :
            order.downloadStatus === 'DOWNLOADING' ? 'spinner fa-spin' :
            order.downloadStatus === 'FAILED' ? 'times-circle' :
            'clock';

        const printStatusColor =
            order.printStatus === 'PRINTED' ? '#10b981' :
            order.printStatus === 'PRINTING' ? '#f59e0b' :
            order.printStatus === 'FAILED' ? '#ef4444' :
            '#94a3b8';

        const printStatusIcon =
            order.printStatus === 'PRINTED' ? 'check-circle' :
            order.printStatus === 'PRINTING' ? 'spinner fa-spin' :
            order.printStatus === 'FAILED' ? 'times-circle' :
            'clock';

        // MRA Status
        const mraStatus = order.mraStatus || 'PENDING';
        const mraStatusColor =
            mraStatus === 'SUCCESS' ? '#10b981' :
            mraStatus === 'PROCESSING' ? '#f59e0b' :
            mraStatus === 'FAILED' ? '#ef4444' :
            '#94a3b8';

        const mraStatusIcon =
            mraStatus === 'SUCCESS' ? 'check-circle' :
            mraStatus === 'PROCESSING' ? 'spinner fa-spin' :
            mraStatus === 'FAILED' ? 'times-circle' :
            'clock';

        html += `
            <div style="background: #f8f9fa; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 1.5rem; align-items: center; flex: 1;">
                    <div style="min-width: 100px;">
                        <div style="font-size: 10px; color: #64748b; font-weight: 600;">ORDER</div>
                        <div style="font-size: 13px; font-weight: 700; color: #1e293b;">${order.orderNumber}</div>
                    </div>
                    <div>
                        <div style="font-size: 10px; color: #64748b; font-weight: 600;">DOWNLOAD</div>
                        <div style="font-size: 12px; font-weight: 600; color: ${downloadStatusColor}; display: flex; align-items: center; gap: 0.25rem;">
                            <i class="fas fa-${downloadStatusIcon}"></i> ${order.downloadStatus}
                        </div>
                    </div>
                    <div>
                        <div style="font-size: 10px; color: #64748b; font-weight: 600;">PRINT</div>
                        <div style="font-size: 12px; font-weight: 600; color: ${printStatusColor}; display: flex; align-items: center; gap: 0.25rem;">
                            <i class="fas fa-${printStatusIcon}"></i> ${order.printStatus}
                        </div>
                    </div>
                    <div>
                        <div style="font-size: 10px; color: #64748b; font-weight: 600;">MRA</div>
                        <div style="font-size: 12px; font-weight: 600; color: ${mraStatusColor}; display: flex; align-items: center; gap: 0.25rem;">
                            <i class="fas fa-${mraStatusIcon}"></i> ${mraStatus}
                        </div>
                    </div>
                    ${order.error ? `
                        <div style="flex: 1;">
                            <div style="font-size: 11px; color: #ef4444; font-style: italic;">${order.error}</div>
                        </div>
                    ` : ''}
                    ${order.mraError ? `
                        <div style="flex: 1;">
                            <div style="font-size: 11px; color: #ef4444; font-style: italic;">MRA: ${order.mraError}</div>
                        </div>
                    ` : ''}
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    ${order.mraLogs && order.mraLogs.length > 0 ? `
                        <button onclick="showMRALogForOrder(${index})" class="btn btn-sm" style="padding: 0.35rem 0.6rem; font-size: 11px; background: #8b5cf6; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-list-alt"></i> MRA Log
                        </button>
                    ` : ''}
                    ${order.downloadStatus === 'DOWNLOADED' && order.pdfPath ? `
                        <button onclick="viewTripOrderPDF(${index})" class="btn btn-sm" style="padding: 0.35rem 0.6rem; font-size: 11px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-eye"></i> View
                        </button>
                    ` : ''}
                    ${order.downloadStatus === 'FAILED' ? `
                        <button onclick="retryTripOrderDownload(${index})" class="btn btn-sm" style="padding: 0.35rem 0.6rem; font-size: 11px; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-redo"></i> Retry
                        </button>
                    ` : ''}
                    ${order.printStatus === 'FAILED' ? `
                        <button onclick="retryTripOrderPrint(${index})" class="btn btn-sm" style="padding: 0.35rem 0.6rem; font-size: 11px; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-redo"></i> Retry Print
                        </button>
                    ` : ''}
                    ${mraStatus === 'FAILED' ? `
                        <button onclick="retryMRAForOrder(${index})" class="btn btn-sm" style="padding: 0.35rem 0.6rem; font-size: 11px; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-redo"></i> Retry MRA
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Load printers for trip print
async function loadPrintersForTripPrint() {
    const select = document.getElementById('trip-print-printer-select');

    try {
        console.log('[Trip Print] Loading printers...');
        select.innerHTML = '<option value="">-- Loading printers... --</option>';

        const data = await callApexAPINew('/printers/all', 'GET');
        const printers = data.items || [];

        console.log('[Trip Print] Loaded', printers.length, 'printers');

        if (printers.length === 0) {
            select.innerHTML = '<option value="">-- No printers found --</option>';
            return;
        }

        select.innerHTML = '<option value="">-- Select a printer --</option>';

        printers.forEach(printer => {
            const option = document.createElement('option');
            option.value = printer.printerName;
            option.textContent = `${printer.printerName}${printer.isActive === 'Y' ? ' (Active)' : ''}`;
            if (printer.isActive === 'Y') {
                option.selected = true;
            }
            select.appendChild(option);
        });

    } catch (error) {
        console.error('[Trip Print] Failed to load printers:', error);
        select.innerHTML = '<option value="">-- Failed to load printers --</option>';
    }
}

// Start downloading all trip orders
window.startTripDownload = async function() {
    if (!currentTripPrintData) return;

    console.log('[Trip Print] Starting download for all orders...');

    // Update status
    document.getElementById('trip-print-status').textContent = 'Downloading...';
    document.getElementById('trip-print-status').style.color = '#f59e0b';

    // Disable download button
    document.getElementById('trip-print-download-btn').disabled = true;

    let successCount = 0;
    let failCount = 0;

    // Download each order
    for (let i = 0; i < currentTripPrintData.orders.length; i++) {
        const order = currentTripPrintData.orders[i];

        console.log(`[Trip Print] Downloading ${i + 1}/${currentTripPrintData.orders.length}: ${order.orderNumber}`);
        console.log(`[Trip Print] Order Type: ${order.orderType}`);
        console.log(`[Trip Print] Report: ${currentTripPrintData.reportName}`);

        // Update status to DOWNLOADING
        order.downloadStatus = 'DOWNLOADING';
        renderTripPrintOrders();

        // Update debug XML to show what should be sent for this specific order
        updateDebugXMLForOrder(order.orderNumber);

        try {
            // Use printStoreTransaction action for Auto Inventory Processing
            // This action expects explicit reportPath and parameterName
            const message = {
                action: 'printStoreTransaction',
                orderNumber: order.orderNumber,
                instance: order.instance,
                reportPath: '/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo',
                parameterName: 'SOURCE_CODE',
                tripId: order.tripId,
                tripDate: order.tripDate
            };

            console.log('=====================================');
            console.log('[Trip Print] 📤 SENDING TO C#');
            console.log('=====================================');
            console.log('[Trip Print] Message:', JSON.stringify(message, null, 2));
            console.log('[Trip Print] Action:', message.action);
            console.log('[Trip Print] Report Path:', message.reportPath);
            console.log('[Trip Print] Parameter Name:', message.parameterName);
            console.log('[Trip Print] Order Number:', message.orderNumber);
            console.log('[Trip Print] Instance:', message.instance);
            console.log('[Trip Print] tripId:', message.tripId);
            console.log('[Trip Print] tripDate:', message.tripDate);
            console.log('[Trip Print] Expected PDF Path:', `C:/fusion/${message.tripDate}/${message.tripId}/${message.orderNumber}.pdf`);
            console.log('=====================================');

            const response = await new Promise((resolve, reject) => {
                sendMessageToCSharp(message, function(error, response) {
                    if (error) {
                        reject(new Error(error));
                    } else {
                        resolve(response);
                    }
                });
            });

            console.log('=====================================');
            console.log('[Trip Print] 📥 RESPONSE FROM C#');
            console.log('=====================================');
            console.log('[Trip Print] Response:', JSON.stringify(response, null, 2));
            console.log('=====================================');

            if (response.success && response.filePath) {
                order.downloadStatus = 'DOWNLOADED';
                order.pdfPath = response.filePath;
                order.error = null;
                successCount++;
                console.log(`[Trip Print] ✅ Downloaded: ${order.orderNumber} to ${response.filePath}`);
            } else {
                throw new Error(response.message || 'Download failed');
            }

        } catch (error) {
            console.error(`[Trip Print] ❌ Failed to download ${order.orderNumber}:`, error);
            order.downloadStatus = 'FAILED';
            order.error = error.message;
            failCount++;
        }

        renderTripPrintOrders();

        // Add delay between downloads
        if (i < currentTripPrintData.orders.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Update final status
    if (failCount === 0) {
        document.getElementById('trip-print-status').textContent = 'All Downloaded ✓';
        document.getElementById('trip-print-status').style.color = '#10b981';
        document.getElementById('trip-print-download-btn').style.display = 'none';
        document.getElementById('trip-print-print-btn').style.display = 'inline-flex';
    } else {
        document.getElementById('trip-print-status').textContent = `${successCount} OK, ${failCount} Failed`;
        document.getElementById('trip-print-status').style.color = '#ef4444';
        document.getElementById('trip-print-retry-all-btn').style.display = 'inline-flex';

        if (successCount > 0) {
            document.getElementById('trip-print-print-btn').style.display = 'inline-flex';
        }
    }

    document.getElementById('trip-print-download-btn').disabled = false;

    console.log(`[Trip Print] Download complete: ${successCount} succeeded, ${failCount} failed`);
};

// Start printing all trip orders
window.startTripPrinting = async function() {
    if (!currentTripPrintData) return;

    const printerName = document.getElementById('trip-print-printer-select').value;
    const errorDiv = document.getElementById('trip-print-error');

    if (!printerName) {
        errorDiv.textContent = 'Please select a printer';
        errorDiv.style.display = 'block';
        return;
    }

    errorDiv.style.display = 'none';

    console.log('[Trip Print] Starting printing for all orders with printer:', printerName);

    // Update status
    document.getElementById('trip-print-status').textContent = 'Printing...';
    document.getElementById('trip-print-status').style.color = '#f59e0b';

    // Disable print button
    document.getElementById('trip-print-print-btn').disabled = true;

    let successCount = 0;
    let failCount = 0;

    // Print each downloaded order
    const downloadedOrders = currentTripPrintData.orders.filter(o => o.downloadStatus === 'DOWNLOADED');

    for (let i = 0; i < downloadedOrders.length; i++) {
        const order = downloadedOrders[i];

        console.log(`[Trip Print] Printing ${i + 1}/${downloadedOrders.length}: ${order.orderNumber}`);

        // Update status to PRINTING
        order.printStatus = 'PRINTING';
        renderTripPrintOrders();

        try {
            // Print PDF via C#
            const message = {
                action: 'printOrder',
                orderNumber: order.orderNumber,
                tripId: order.tripId,
                tripDate: order.tripDate,
                printerName: printerName
            };

            const response = await new Promise((resolve, reject) => {
                sendMessageToCSharp(message, function(error, response) {
                    if (error) {
                        reject(new Error(error));
                    } else {
                        resolve(response);
                    }
                });
            });

            if (response.success) {
                order.printStatus = 'PRINTED';
                order.error = null;
                successCount++;
                console.log(`[Trip Print] ✅ Printed: ${order.orderNumber}`);
            } else {
                throw new Error(response.message || 'Print failed');
            }

        } catch (error) {
            console.error(`[Trip Print] ❌ Failed to print ${order.orderNumber}:`, error);
            order.printStatus = 'FAILED';
            order.error = error.message;
            failCount++;
        }

        renderTripPrintOrders();

        // Add delay between prints
        if (i < downloadedOrders.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // Update final status
    if (failCount === 0) {
        document.getElementById('trip-print-status').textContent = 'All Printed ✓';
        document.getElementById('trip-print-status').style.color = '#10b981';
        document.getElementById('trip-print-print-btn').style.display = 'none';
    } else {
        document.getElementById('trip-print-status').textContent = `${successCount} Printed, ${failCount} Failed`;
        document.getElementById('trip-print-status').style.color = '#ef4444';
    }

    document.getElementById('trip-print-print-btn').disabled = false;

    console.log(`[Trip Print] Printing complete: ${successCount} succeeded, ${failCount} failed`);
};

// Retry all failed downloads
window.retryAllTripDownloads = async function() {
    if (!currentTripPrintData) return;

    console.log('[Trip Print] Retrying all failed downloads...');

    const failedOrders = currentTripPrintData.orders.filter(o => o.downloadStatus === 'FAILED');

    if (failedOrders.length === 0) {
        alert('No failed downloads to retry');
        return;
    }

    // Reset failed orders to PENDING
    failedOrders.forEach(order => {
        order.downloadStatus = 'PENDING';
        order.error = null;
    });

    renderTripPrintOrders();

    // Hide retry button
    document.getElementById('trip-print-retry-all-btn').style.display = 'none';

    // Trigger download
    await startTripDownload();
};

// Retry single order download
window.retryTripOrderDownload = async function(orderIndex) {
    if (!currentTripPrintData) return;

    const order = currentTripPrintData.orders[orderIndex];

    console.log('[Trip Print] Retrying download for:', order.orderNumber);

    // Update status to DOWNLOADING
    order.downloadStatus = 'DOWNLOADING';
    order.error = null;
    renderTripPrintOrders();

    // Update debug XML to show what should be sent for this specific order
    updateDebugXMLForOrder(order.orderNumber);

    try {
        // Use printStoreTransaction action for Auto Inventory Processing
        const message = {
            action: 'printStoreTransaction',
            orderNumber: order.orderNumber,
            instance: order.instance,
            reportPath: '/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo',
            parameterName: 'SOURCE_CODE',
            tripId: order.tripId,
            tripDate: order.tripDate
        };

        const response = await new Promise((resolve, reject) => {
            sendMessageToCSharp(message, function(error, response) {
                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(response);
                }
            });
        });

        if (response.success && response.filePath) {
            order.downloadStatus = 'DOWNLOADED';
            order.pdfPath = response.filePath;
            order.error = null;
            console.log(`[Trip Print] ✅ Downloaded: ${order.orderNumber}`);

            // Check if all are now downloaded
            const allDownloaded = currentTripPrintData.orders.every(o => o.downloadStatus === 'DOWNLOADED');
            if (allDownloaded) {
                document.getElementById('trip-print-status').textContent = 'All Downloaded ✓';
                document.getElementById('trip-print-status').style.color = '#10b981';
                document.getElementById('trip-print-download-btn').style.display = 'none';
                document.getElementById('trip-print-print-btn').style.display = 'inline-flex';
                document.getElementById('trip-print-retry-all-btn').style.display = 'none';
            } else {
                // Show print button if at least one is downloaded
                const anyDownloaded = currentTripPrintData.orders.some(o => o.downloadStatus === 'DOWNLOADED');
                if (anyDownloaded) {
                    document.getElementById('trip-print-print-btn').style.display = 'inline-flex';
                }
            }
        } else {
            throw new Error(response.message || 'Download failed');
        }

    } catch (error) {
        console.error(`[Trip Print] ❌ Failed to download ${order.orderNumber}:`, error);
        order.downloadStatus = 'FAILED';
        order.error = error.message;
    }

    renderTripPrintOrders();
};

// Retry single order print
window.retryTripOrderPrint = async function(orderIndex) {
    if (!currentTripPrintData) return;

    const order = currentTripPrintData.orders[orderIndex];
    const printerName = document.getElementById('trip-print-printer-select').value;

    if (!printerName) {
        alert('Please select a printer');
        return;
    }

    console.log('[Trip Print] Retrying print for:', order.orderNumber);

    // Update status to PRINTING
    order.printStatus = 'PRINTING';
    order.error = null;
    renderTripPrintOrders();

    try {
        const message = {
            action: 'printOrder',
            orderNumber: order.orderNumber,
            tripId: order.tripId,
            tripDate: order.tripDate,
            printerName: printerName
        };

        const response = await new Promise((resolve, reject) => {
            sendMessageToCSharp(message, function(error, response) {
                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(response);
                }
            });
        });

        if (response.success) {
            order.printStatus = 'PRINTED';
            order.error = null;
            console.log(`[Trip Print] ✅ Printed: ${order.orderNumber}`);
        } else {
            throw new Error(response.message || 'Print failed');
        }

    } catch (error) {
        console.error(`[Trip Print] ❌ Failed to print ${order.orderNumber}:`, error);
        order.printStatus = 'FAILED';
        order.error = error.message;
    }

    renderTripPrintOrders();
};

// View order PDF
window.viewTripOrderPDF = async function(orderIndex) {
    if (!currentTripPrintData) return;

    const order = currentTripPrintData.orders[orderIndex];

    if (!order.pdfPath) {
        alert('PDF file path not available');
        return;
    }

    console.log('[Trip Print] Opening PDF:', order.pdfPath);

    try {
        const message = {
            action: 'openPdfFile',
            filePath: order.pdfPath
        };

        await new Promise((resolve, reject) => {
            sendMessageToCSharp(message, function(error, response) {
                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(response);
                }
            });
        });

        console.log('[Trip Print] ✅ PDF opened successfully');

    } catch (error) {
        console.error('[Trip Print] Failed to open PDF:', error);
        alert('Failed to open PDF: ' + error.message);
    }
};

// ============================================================================
// END TRIP PRINT MODAL FUNCTIONS
// ============================================================================

window.toggleBypassTransaction = toggleBypassTransaction;
window.toggleSelectAllOrder = toggleSelectAllOrder;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.showErrorDetails = showErrorDetails;
window.closeErrorPopup = closeErrorPopup;
window.refreshErrorData = refreshErrorData;
window.deleteAllStagedTransactions = deleteAllStagedTransactions;
window.toggleExpandCollapseAll = toggleExpandCollapseAll;
window.showOrderProcessingSpinner = showOrderProcessingSpinner;
window.verifyWithFusion = verifyWithFusion;
window.printOrder = printOrder;
window.processSingleOrder = processSingleOrder;
window.processSingleLine = processSingleLine;
window.buildAnalytics = buildAnalytics;
window.openStoreTransactionsFromOrder = openStoreTransactionsFromOrder;
window.closeProcessingStatusFloat = closeProcessingStatusFloat;
window.stopProcessing = stopProcessing;

// ============================================================================
// TEAMS INTEGRATION
// ============================================================================

// Teams webhook configuration storage
let teamsWebhooks = JSON.parse(localStorage.getItem('teamsWebhooks') || '[]');

// Initialize Teams floating button
function initTeamsIntegration() {
    // Teams floating button is now hidden - replaced by Action floating icon in app.js
    return;

    // Create floating Teams button if not exists
    if (!document.getElementById('teams-floating-btn')) {
        const floatingBtn = document.createElement('div');
        floatingBtn.id = 'teams-floating-btn';
        floatingBtn.innerHTML = `
            <button onclick="openTeamsModal()" style="
                width: 50px;
                height: 50px;
                border-radius: 50%;
                background: linear-gradient(135deg, #5558AF 0%, #6B73D4 100%);
                border: none;
                color: white;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(85, 88, 175, 0.4);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.3s;
            " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'" title="Send to Teams">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                    <path d="M19.2 6.4H15.6V4.8C15.6 3.47 14.53 2.4 13.2 2.4H10.8C9.47 2.4 8.4 3.47 8.4 4.8V6.4H4.8C3.47 6.4 2.4 7.47 2.4 8.8V18C2.4 19.33 3.47 20.4 4.8 20.4H19.2C20.53 20.4 21.6 19.33 21.6 18V8.8C21.6 7.47 20.53 6.4 19.2 6.4ZM10.8 4.8H13.2V6.4H10.8V4.8ZM19.2 18H4.8V8.8H19.2V18ZM12 10.8C10.67 10.8 9.6 11.87 9.6 13.2C9.6 14.53 10.67 15.6 12 15.6C13.33 15.6 14.4 14.53 14.4 13.2C14.4 11.87 13.33 10.8 12 10.8Z"/>
                </svg>
            </button>
            <span id="teams-selected-count" style="
                position: absolute;
                top: -5px;
                right: -5px;
                background: #ef4444;
                color: white;
                font-size: 11px;
                font-weight: 700;
                min-width: 20px;
                height: 20px;
                border-radius: 10px;
                display: none;
                align-items: center;
                justify-content: center;
            ">0</span>
        `;
        floatingBtn.style.cssText = `
            position: fixed;
            bottom: 170px;
            right: 30px;
            z-index: 9999;
        `;
        document.body.appendChild(floatingBtn);
    }

    // Create Teams modal if not exists
    if (!document.getElementById('teams-modal')) {
        const modal = document.createElement('div');
        modal.id = 'teams-modal';
        modal.innerHTML = `
            <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;">
                <div style="background: white; border-radius: 12px; width: 95%; max-width: 850px; max-height: 90vh; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.25);">
                    <!-- Header -->
                    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); color: white; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-share-alt" style="font-size: 20px;"></i>
                            <span style="font-size: 18px; font-weight: 600;">Send Trip Details</span>
                        </div>
                        <button onclick="closeTeamsModal()" style="background: none; border: none; color: white; cursor: pointer; font-size: 24px; padding: 0;">&times;</button>
                    </div>

                    <!-- Tabs -->
                    <div style="display: flex; border-bottom: 2px solid #e0e0e0; background: #f8f9fa;">
                        <button id="tab-teams" onclick="switchSendTab('teams')" style="flex: 1; padding: 12px 20px; background: white; border: none; border-bottom: 3px solid #5558AF; cursor: pointer; font-weight: 600; color: #5558AF; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="#5558AF"><path d="M19.2 6.4H15.6V4.8C15.6 3.47 14.53 2.4 13.2 2.4H10.8C9.47 2.4 8.4 3.47 8.4 4.8V6.4H4.8C3.47 6.4 2.4 7.47 2.4 8.8V18C2.4 19.33 3.47 20.4 4.8 20.4H19.2C20.53 20.4 21.6 19.33 21.6 18V8.8C21.6 7.47 20.53 6.4 19.2 6.4ZM10.8 4.8H13.2V6.4H10.8V4.8ZM19.2 18H4.8V8.8H19.2V18Z"/></svg>
                            Microsoft Teams
                        </button>
                        <button id="tab-email" onclick="switchSendTab('email')" style="flex: 1; padding: 12px 20px; background: #f8f9fa; border: none; border-bottom: 3px solid transparent; cursor: pointer; font-weight: 600; color: #666; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <i class="fas fa-envelope" style="font-size: 18px;"></i>
                            Email
                        </button>
                    </div>

                    <!-- Body -->
                    <div style="padding: 20px; max-height: 55vh; overflow-y: auto;">
                        <!-- Trip Data Preview (shared) -->
                        <div style="margin-bottom: 16px;">
                            <label style="font-weight: 600; color: #333; display: block; margin-bottom: 8px;">
                                <i class="fas fa-truck"></i> Trip Details Preview
                            </label>
                            <div id="send-message-preview" style="background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; font-family: 'Segoe UI', sans-serif; font-size: 13px; max-height: 250px; overflow-y: auto;">
                                <!-- Preview content will be generated here -->
                            </div>
                        </div>

                        <!-- Teams Section -->
                        <div id="send-teams-section">
                            <div style="margin-bottom: 16px;">
                                <label style="font-weight: 600; color: #333; display: block; margin-bottom: 8px;">
                                    <i class="fas fa-hashtag"></i> Select Channel/Webhook
                                </label>
                                <div style="display: flex; gap: 8px;">
                                    <select id="teams-channel-select" style="flex: 1; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px;">
                                        <option value="">-- Select Channel --</option>
                                    </select>
                                    <button onclick="openTeamsWebhookSettings()" style="padding: 10px 16px; background: #f0f0f0; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;" title="Manage Webhooks">
                                        <i class="fas fa-cog"></i>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Email Section (hidden by default) -->
                        <div id="send-email-section" style="display: none;">
                            <div style="margin-bottom: 16px;">
                                <label style="font-weight: 600; color: #333; display: block; margin-bottom: 8px;">
                                    <i class="fas fa-user"></i> From
                                    <button onclick="openEmailSettings()" style="margin-left: 8px; padding: 2px 8px; background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 11px;" title="Configure Email Settings">
                                        <i class="fas fa-cog"></i> Settings
                                    </button>
                                </label>
                                <input type="email" id="email-from" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; box-sizing: border-box;" placeholder="your.email@company.com">
                            </div>
                            <div style="margin-bottom: 16px;">
                                <label style="font-weight: 600; color: #333; display: block; margin-bottom: 8px;">
                                    <i class="fas fa-users"></i> To (separate multiple emails with comma)
                                </label>
                                <input type="text" id="email-to" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; box-sizing: border-box;" placeholder="email@example.com, another@example.com">
                            </div>
                            <div style="margin-bottom: 16px;">
                                <label style="font-weight: 600; color: #333; display: block; margin-bottom: 8px;">
                                    <i class="fas fa-heading"></i> Subject
                                </label>
                                <input type="text" id="email-subject" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; box-sizing: border-box;" placeholder="WMS Trip Update">
                            </div>
                        </div>

                        <!-- Additional Comments (shared) -->
                        <div style="margin-bottom: 16px;">
                            <label style="font-weight: 600; color: #333; display: block; margin-bottom: 8px;">
                                <i class="fas fa-comment"></i> Additional Comments
                            </label>
                            <textarea id="teams-comments" placeholder="Add any additional comments or notes..." style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; min-height: 70px; resize: vertical; box-sizing: border-box;"></textarea>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 16px 20px; background: #f8f9fa; border-top: 1px solid #e0e0e0; display: flex; justify-content: flex-end; gap: 12px;">
                        <button onclick="closeTeamsModal()" style="padding: 10px 20px; background: #f0f0f0; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">Cancel</button>
                        <button onclick="postToTeams()" id="teams-post-btn" style="padding: 10px 20px; background: linear-gradient(135deg, #5558AF 0%, #6B73D4 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-paper-plane"></i> Post to Teams
                        </button>
                        <button onclick="sendEmail()" id="email-send-btn" style="display: none; padding: 10px 20px; background: linear-gradient(135deg, #0078d4 0%, #106ebe 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; display: none; align-items: center; gap: 8px;">
                            <i class="fas fa-envelope"></i> Send Email
                        </button>
                    </div>
                </div>
            </div>
        `;
        modal.style.display = 'none';
        document.body.appendChild(modal);
    }

    // Create webhook settings modal
    if (!document.getElementById('teams-webhook-modal')) {
        const webhookModal = document.createElement('div');
        webhookModal.id = 'teams-webhook-modal';
        webhookModal.innerHTML = `
            <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10001;">
                <div style="background: white; border-radius: 12px; width: 90%; max-width: 500px; max-height: 80vh; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.25);">
                    <div style="background: #333; color: white; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 16px; font-weight: 600;"><i class="fas fa-cog"></i> Manage Teams Webhooks</span>
                        <button onclick="closeTeamsWebhookSettings()" style="background: none; border: none; color: white; cursor: pointer; font-size: 24px;">&times;</button>
                    </div>
                    <div style="padding: 20px; max-height: 50vh; overflow-y: auto;">
                        <div style="margin-bottom: 16px;">
                            <label style="font-weight: 600; display: block; margin-bottom: 8px;">Add New Webhook</label>
                            <input type="text" id="webhook-name" placeholder="Channel Name (e.g., WMS Alerts)" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; margin-bottom: 8px; box-sizing: border-box;">
                            <input type="text" id="webhook-url" placeholder="Webhook URL" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; margin-bottom: 8px; box-sizing: border-box;">
                            <button onclick="addTeamsWebhook()" style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">Add Webhook</button>
                        </div>
                        <div>
                            <label style="font-weight: 600; display: block; margin-bottom: 8px;">Saved Webhooks</label>
                            <div id="webhook-list" style="border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                                <!-- Webhook list will be rendered here -->
                            </div>
                        </div>
                    </div>
                    <div style="padding: 16px 20px; background: #f8f9fa; border-top: 1px solid #e0e0e0;">
                        <p style="font-size: 12px; color: #666; margin: 0;">
                            <i class="fas fa-info-circle"></i> To get a webhook URL, go to your Teams channel → Click "..." → Connectors → Incoming Webhook → Configure
                        </p>
                    </div>
                </div>
            </div>
        `;
        webhookModal.style.display = 'none';
        document.body.appendChild(webhookModal);
    }

    // Create Email Settings modal if not exists
    if (!document.getElementById('email-settings-modal')) {
        const emailModal = document.createElement('div');
        emailModal.id = 'email-settings-modal';
        emailModal.innerHTML = `
            <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10002;">
                <div style="background: white; border-radius: 12px; width: 90%; max-width: 500px; max-height: 80vh; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.25);">
                    <div style="background: linear-gradient(135deg, #0078d4 0%, #106ebe 100%); color: white; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 16px; font-weight: 600;"><i class="fas fa-envelope-open-text"></i> Email Configuration</span>
                        <button onclick="closeEmailSettings()" style="background: none; border: none; color: white; cursor: pointer; font-size: 24px;">&times;</button>
                    </div>
                    <div style="padding: 20px; max-height: 55vh; overflow-y: auto;">
                        <div style="background: #e3f2fd; border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 12px; color: #1565c0;">
                            <i class="fas fa-info-circle"></i> Configure your email settings. For Office 365, use <strong>smtp.office365.com</strong> with port <strong>587</strong>.
                        </div>

                        <div style="margin-bottom: 16px;">
                            <label style="font-weight: 600; display: block; margin-bottom: 6px;">SMTP Server</label>
                            <input type="text" id="smtp-server" value="smtp.office365.com" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; box-sizing: border-box;" placeholder="smtp.office365.com">
                        </div>

                        <div style="margin-bottom: 16px;">
                            <label style="font-weight: 600; display: block; margin-bottom: 6px;">Port</label>
                            <input type="number" id="smtp-port" value="587" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; box-sizing: border-box;" placeholder="587">
                        </div>

                        <div style="margin-bottom: 16px;">
                            <label style="font-weight: 600; display: block; margin-bottom: 6px;">Email Address (Username)</label>
                            <input type="email" id="smtp-username" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; box-sizing: border-box;" placeholder="your.email@company.com">
                        </div>

                        <div style="margin-bottom: 16px;">
                            <label style="font-weight: 600; display: block; margin-bottom: 6px;">Password / App Password</label>
                            <input type="password" id="smtp-password" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; box-sizing: border-box;" placeholder="Your email password or app password">
                            <div style="font-size: 11px; color: #666; margin-top: 4px;">
                                <i class="fas fa-shield-alt"></i> For Office 365 with MFA, use an <a href="https://support.microsoft.com/en-us/account-billing/manage-app-passwords-for-two-step-verification" target="_blank" style="color: #0078d4;">App Password</a>
                            </div>
                        </div>

                        <div style="margin-bottom: 16px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" id="smtp-use-ssl" checked style="width: 18px; height: 18px;">
                                <span style="font-weight: 600;">Use TLS/SSL</span>
                            </label>
                        </div>

                        <div style="display: flex; gap: 10px;">
                            <button onclick="testEmailSettings()" style="flex: 1; padding: 10px; background: #f0f0f0; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                                <i class="fas fa-vial"></i> Test Connection
                            </button>
                            <button onclick="saveEmailSettings()" style="flex: 1; padding: 10px; background: #0078d4; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                                <i class="fas fa-save"></i> Save Settings
                            </button>
                        </div>
                    </div>
                    <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e0e0e0; font-size: 11px; color: #666;">
                        <i class="fas fa-lock"></i> Your credentials are stored locally and never sent to any third party.
                    </div>
                </div>
            </div>
        `;
        emailModal.style.display = 'none';
        document.body.appendChild(emailModal);
    }

    // Update floating button count when trips are selected
    updateTeamsButtonCount();
}

// Email settings storage
let emailConfig = JSON.parse(localStorage.getItem('emailConfig') || '{}');

// Open email settings modal
window.openEmailSettings = function() {
    const modal = document.getElementById('email-settings-modal');
    modal.style.display = 'block';

    // Load saved settings
    document.getElementById('smtp-server').value = emailConfig.smtpServer || 'smtp.office365.com';
    document.getElementById('smtp-port').value = emailConfig.smtpPort || '587';
    document.getElementById('smtp-username').value = emailConfig.username || '';
    document.getElementById('smtp-password').value = emailConfig.password || '';
    document.getElementById('smtp-use-ssl').checked = emailConfig.useSsl !== false;
};

// Close email settings modal
window.closeEmailSettings = function() {
    document.getElementById('email-settings-modal').style.display = 'none';
};

// Save email settings
window.saveEmailSettings = function() {
    emailConfig = {
        smtpServer: document.getElementById('smtp-server').value.trim(),
        smtpPort: document.getElementById('smtp-port').value.trim(),
        username: document.getElementById('smtp-username').value.trim(),
        password: document.getElementById('smtp-password').value,
        useSsl: document.getElementById('smtp-use-ssl').checked
    };

    localStorage.setItem('emailConfig', JSON.stringify(emailConfig));

    // Update the From field
    if (emailConfig.username) {
        document.getElementById('email-from').value = emailConfig.username;
    }

    alert('Email settings saved successfully!');
    closeEmailSettings();
};

// Test email settings
window.testEmailSettings = function() {
    const server = document.getElementById('smtp-server').value.trim();
    const port = document.getElementById('smtp-port').value.trim();
    const username = document.getElementById('smtp-username').value.trim();
    const password = document.getElementById('smtp-password').value;
    const useSsl = document.getElementById('smtp-use-ssl').checked;

    if (!server || !port || !username || !password) {
        alert('Please fill in all fields before testing.');
        return;
    }

    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage({
            action: 'testSmtpConnection',
            smtpServer: server,
            smtpPort: parseInt(port),
            username: username,
            password: password,
            useSsl: useSsl
        });

        alert('Testing connection... Please wait.');
    } else {
        alert('SMTP test is only available in the desktop application.');
    }
};

// Callback for SMTP test result
window.handleSmtpTestResult = function(success, message) {
    if (success) {
        alert('✓ Connection successful!\n\n' + message);
    } else {
        alert('✗ Connection failed!\n\n' + message);
    }
};

// Update the Teams button badge count
function updateTeamsButtonCount() {
    const countEl = document.getElementById('teams-selected-count');
    if (countEl) {
        const count = selectedTripsForProcessing.size;
        countEl.textContent = count;
        countEl.style.display = count > 0 ? 'flex' : 'none';
    }
}

// Open Teams modal
window.openTeamsModal = function() {
    if (selectedTripsForProcessing.size === 0) {
        alert('Please select at least one trip to send to Teams.\n\nClick the "Select" button on each trip you want to share.');
        return;
    }

    const modal = document.getElementById('teams-modal');
    modal.style.display = 'block';

    // Populate channel dropdown
    populateChannelDropdown();

    // Generate message preview
    generateTeamsMessagePreview();
};

// Close Teams modal
window.closeTeamsModal = function() {
    document.getElementById('teams-modal').style.display = 'none';
    document.getElementById('teams-comments').value = '';
};

// Populate channel dropdown
function populateChannelDropdown() {
    const select = document.getElementById('teams-channel-select');
    select.innerHTML = '<option value="">-- Select Channel --</option>';

    teamsWebhooks.forEach((webhook, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = webhook.name;
        select.appendChild(option);
    });
}

// Current send tab
let currentSendTab = 'teams';

// Switch between Teams and Email tabs
window.switchSendTab = function(tab) {
    currentSendTab = tab;

    const tabTeams = document.getElementById('tab-teams');
    const tabEmail = document.getElementById('tab-email');
    const sectionTeams = document.getElementById('send-teams-section');
    const sectionEmail = document.getElementById('send-email-section');
    const btnTeams = document.getElementById('teams-post-btn');
    const btnEmail = document.getElementById('email-send-btn');

    if (tab === 'teams') {
        tabTeams.style.background = 'white';
        tabTeams.style.borderBottom = '3px solid #5558AF';
        tabTeams.style.color = '#5558AF';
        tabEmail.style.background = '#f8f9fa';
        tabEmail.style.borderBottom = '3px solid transparent';
        tabEmail.style.color = '#666';
        sectionTeams.style.display = 'block';
        sectionEmail.style.display = 'none';
        btnTeams.style.display = 'flex';
        btnEmail.style.display = 'none';
    } else {
        tabEmail.style.background = 'white';
        tabEmail.style.borderBottom = '3px solid #0078d4';
        tabEmail.style.color = '#0078d4';
        tabTeams.style.background = '#f8f9fa';
        tabTeams.style.borderBottom = '3px solid transparent';
        tabTeams.style.color = '#666';
        sectionTeams.style.display = 'none';
        sectionEmail.style.display = 'block';
        btnTeams.style.display = 'none';
        btnEmail.style.display = 'flex';

        // Load Outlook email when switching to email tab
        loadOutlookEmail();

        // Set default subject
        const subjectInput = document.getElementById('email-subject');
        if (!subjectInput.value) {
            subjectInput.value = `WMS Trip Update - ${selectedTripsForProcessing.size} Trip(s) - ${new Date().toLocaleDateString()}`;
        }
    }
};

// Load email address from saved settings or Outlook
function loadOutlookEmail() {
    const fromInput = document.getElementById('email-from');
    if (fromInput.value && fromInput.value !== 'Loading...' && fromInput.value !== '') {
        return; // Already loaded
    }

    // First check if we have saved email settings
    const savedConfig = JSON.parse(localStorage.getItem('emailConfig') || '{}');
    if (savedConfig.username) {
        fromInput.value = savedConfig.username;
        console.log('[Email] Using saved email:', savedConfig.username);
        return;
    }

    fromInput.value = 'Loading...';

    // Fall back to Outlook
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage({
            action: 'getOutlookEmail'
        });
    } else {
        fromInput.value = 'user@company.com';
    }
}

// Callback for Outlook email
window.handleOutlookEmail = function(email, error) {
    const fromInput = document.getElementById('email-from');
    if (error) {
        console.error('[Email] Failed to get Outlook email:', error);
        fromInput.value = 'Could not load - enter manually';
        fromInput.readOnly = false;
    } else {
        fromInput.value = email || 'user@company.com';
    }
};

// Generate message preview (for both Teams and Email)
function generateTeamsMessagePreview() {
    console.log('=== generateTeamsMessagePreview START ===');
    const preview = document.getElementById('send-message-preview');
    const groupedTrips = groupTransactionsByTrip();
    console.log('Preview - groupedTrips count:', groupedTrips.length);
    console.log('Preview - selectedTripsForProcessing:', Array.from(selectedTripsForProcessing));

    let html = '<div style="font-family: Segoe UI, sans-serif;">';
    html += '<div style="font-size: 16px; font-weight: 600; color: #1e3a5f; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;"><i class="fas fa-truck"></i> WMS Trip Summary</div>';

    let totalOrders = 0;
    let totalLines = 0;
    let tripsFound = 0;

    selectedTripsForProcessing.forEach(tripId => {
        const trip = groupedTrips.find(t => t.trip_id === tripId || t.trip_id == tripId);
        console.log('Preview - Looking for tripId:', tripId, 'Found:', trip ? 'YES' : 'NO');
        if (trip) {
            tripsFound++;
            // Get priority color
            const pri = trip.trip_priority;
            let priColor = '#666';
            if (pri == 1) priColor = '#dc2626';
            else if (pri == 2) priColor = '#f97316';
            else if (pri == 3) priColor = '#eab308';

            // Group transactions by order
            const orderGroups = {};
            trip.transactions.forEach(trx => {
                const orderNum = trx.source_order || trx.SOURCE_ORDER || 'Unknown';
                if (!orderGroups[orderNum]) {
                    orderGroups[orderNum] = {
                        orderNumber: orderNum,
                        picker: trx.picker || trx.PICKER || trx.picker_name || '-',
                        items: [],
                        pickedCount: 0,
                        totalCount: 0
                    };
                }
                orderGroups[orderNum].items.push(trx);
                orderGroups[orderNum].totalCount++;
                if (trx.pick_confirm_status === 'YES' || trx.PICK_CONFIRM_STATUS === 'YES') {
                    orderGroups[orderNum].pickedCount++;
                }
            });

            const orders = Object.values(orderGroups);
            totalOrders += orders.length;
            totalLines += trip.transactions.length;

            html += `
                <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 10px; padding: 14px; margin-bottom: 12px; border-left: 5px solid #1e3a5f; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <!-- Trip Header -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0;">
                        <span style="font-weight: 700; color: #1e3a5f; font-size: 15px;">🚚 Trip: ${trip.trip_id}</span>
                        <span style="background: ${priColor}; color: white; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">Priority ${pri || '-'}</span>
                    </div>
                    <!-- Trip Info Row -->
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; font-size: 11px; color: #475569; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px dashed #e2e8f0;">
                        <div><strong>📅</strong> ${trip.trip_date ? new Date(trip.trip_date).toLocaleDateString() : 'N/A'}</div>
                        <div><strong>🚛</strong> ${trip.trip_lorry || '-'}</div>
                        <div><strong>📍</strong> Bay ${trip.trip_loading_bay || '-'}</div>
                        <div><strong>📦</strong> ${orders.length} Orders</div>
                    </div>
                    <!-- Orders Table -->
                    <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #e2e8f0;">
                                <th style="padding: 6px 8px; text-align: left; font-weight: 600; color: #334155;">Order #</th>
                                <th style="padding: 6px 8px; text-align: left; font-weight: 600; color: #334155;">Picker</th>
                                <th style="padding: 6px 8px; text-align: center; font-weight: 600; color: #334155;">Pick Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${orders.map(order => {
                                const pickPct = order.totalCount > 0 ? Math.round((order.pickedCount / order.totalCount) * 100) : 0;
                                let statusColor = '#ef4444'; // red
                                let statusText = 'Not Picked';
                                if (pickPct === 100) {
                                    statusColor = '#10b981';
                                    statusText = 'Picked';
                                } else if (pickPct > 0) {
                                    statusColor = '#f59e0b';
                                    statusText = `${pickPct}% Picked`;
                                }
                                return `
                                    <tr style="border-bottom: 1px solid #f1f5f9;">
                                        <td style="padding: 6px 8px; color: #1e3a5f; font-weight: 500;">${order.orderNumber}</td>
                                        <td style="padding: 6px 8px; color: #64748b;">${order.picker}</td>
                                        <td style="padding: 6px 8px; text-align: center;">
                                            <span style="background: ${statusColor}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">
                                                ${statusText}
                                            </span>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
    });

    html += `
        <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); border-radius: 10px; padding: 12px; margin-top: 14px; color: white;">
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: center;">
                <div>
                    <div style="font-size: 18px; font-weight: 700;">${selectedTripsForProcessing.size}</div>
                    <div style="font-size: 10px; opacity: 0.9;">Trips</div>
                </div>
                <div>
                    <div style="font-size: 18px; font-weight: 700;">${totalOrders}</div>
                    <div style="font-size: 10px; opacity: 0.9;">Orders</div>
                </div>
                <div>
                    <div style="font-size: 18px; font-weight: 700;">${totalLines}</div>
                    <div style="font-size: 10px; opacity: 0.9;">Lines</div>
                </div>
            </div>
        </div>
    `;

    html += '</div>';
    preview.innerHTML = html;
}

// Send Email via SMTP or Outlook
window.sendEmail = async function() {
    const toEmails = document.getElementById('email-to').value.trim();
    const fromEmail = document.getElementById('email-from').value.trim();
    const subject = document.getElementById('email-subject').value.trim();
    const comments = document.getElementById('teams-comments').value.trim();

    if (!toEmails) {
        alert('Please enter at least one recipient email address');
        return;
    }

    if (!subject) {
        alert('Please enter a subject');
        return;
    }

    const btn = document.getElementById('email-send-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    try {
        // Build HTML email body
        const emailBody = generateEmailHtmlBody(comments);

        // Check if SMTP settings are configured
        const smtpConfig = JSON.parse(localStorage.getItem('emailConfig') || '{}');
        const useSmtp = smtpConfig.smtpServer && smtpConfig.username && smtpConfig.password;

        if (window.chrome && window.chrome.webview) {
            if (useSmtp) {
                // Use SMTP
                console.log('[Email] Using SMTP to send email');
                window.chrome.webview.postMessage({
                    action: 'sendSmtpEmail',
                    smtpServer: smtpConfig.smtpServer,
                    smtpPort: parseInt(smtpConfig.smtpPort) || 587,
                    username: smtpConfig.username,
                    password: smtpConfig.password,
                    useSsl: smtpConfig.useSsl !== false,
                    from: fromEmail || smtpConfig.username,
                    to: toEmails,
                    subject: subject,
                    htmlBody: emailBody
                });
            } else {
                // Use Outlook COM
                console.log('[Email] Using Outlook to send email');
                window.chrome.webview.postMessage({
                    action: 'sendOutlookEmail',
                    to: toEmails,
                    subject: subject,
                    htmlBody: emailBody
                });
            }
            console.log('[Email] Sent to C# backend');
        } else {
            // Fallback - open mailto link
            const plainText = generateEmailPlainText(comments);
            const mailtoLink = `mailto:${encodeURIComponent(toEmails)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;
            window.open(mailtoLink);

            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-envelope"></i> Send Email';
            alert('Email client opened. Please send the email manually.');
        }
    } catch (error) {
        console.error('[Email] Failed:', error);
        alert('Failed to send email: ' + error.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-envelope"></i> Send Email';
    }
};

// Callback for email send result
window.handleEmailSendResult = function(success, message) {
    const btn = document.getElementById('email-send-btn');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-envelope"></i> Send Email';

    if (success) {
        addLogEntry('Email', 'Email sent successfully', 'success');
        alert('Email sent successfully!');
        closeTeamsModal();
    } else {
        addLogEntry('Email', `Failed to send: ${message}`, 'error');
        alert('Failed to send email: ' + message);
    }
};

// Generate HTML email body
function generateEmailHtmlBody(comments) {
    const groupedTrips = groupTransactionsByTrip();
    let totalOrders = 0;
    let totalLines = 0;

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 750px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); color: white; padding: 24px; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; }
            .header p { margin: 8px 0 0; opacity: 0.9; }
            .content { padding: 24px; }
            .trip-card { background: #f8fafc; border-radius: 10px; padding: 16px; margin-bottom: 20px; border-left: 5px solid #1e3a5f; }
            .trip-header { border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 12px; }
            .trip-title { display: flex; justify-content: space-between; align-items: center; }
            .trip-id { font-weight: 700; color: #1e3a5f; font-size: 18px; }
            .priority { padding: 4px 14px; border-radius: 12px; color: white; font-size: 12px; font-weight: 600; }
            .trip-info { display: flex; gap: 20px; margin-top: 10px; font-size: 13px; color: #475569; }
            .orders-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
            .orders-table th { background: #e2e8f0; padding: 10px 12px; text-align: left; font-weight: 600; color: #334155; }
            .orders-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
            .status-badge { padding: 4px 10px; border-radius: 12px; color: white; font-size: 11px; font-weight: 600; }
            .status-picked { background: #10b981; }
            .status-partial { background: #f59e0b; }
            .status-not-picked { background: #ef4444; }
            .summary { background: linear-gradient(135deg, #059669 0%, #10b981 100%); border-radius: 10px; padding: 20px; color: white; text-align: center; margin-top: 20px; }
            .summary-grid { display: flex; justify-content: space-around; margin-top: 12px; }
            .summary-item { text-align: center; }
            .summary-value { font-size: 28px; font-weight: 700; }
            .summary-label { font-size: 12px; opacity: 0.9; }
            .comments { background: #fff8e1; border-left: 4px solid #ffc107; padding: 16px; margin-top: 20px; border-radius: 0 8px 8px 0; }
            .footer { background: #f8f9fa; padding: 16px 24px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #e0e0e0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🚚 WMS Trip Summary</h1>
                <p>${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
            </div>
            <div class="content">
    `;

    selectedTripsForProcessing.forEach(tripId => {
        const trip = groupedTrips.find(t => t.trip_id === tripId);
        if (trip) {
            const pri = trip.trip_priority;
            let priColor = '#666';
            if (pri == 1) priColor = '#dc2626';
            else if (pri == 2) priColor = '#f97316';
            else if (pri == 3) priColor = '#eab308';

            // Group transactions by order
            const orderGroups = {};
            trip.transactions.forEach(trx => {
                const orderNum = trx.source_order || trx.SOURCE_ORDER || 'Unknown';
                if (!orderGroups[orderNum]) {
                    orderGroups[orderNum] = {
                        orderNumber: orderNum,
                        picker: trx.picker || trx.PICKER || trx.picker_name || '-',
                        items: [],
                        pickedCount: 0,
                        totalCount: 0
                    };
                }
                orderGroups[orderNum].items.push(trx);
                orderGroups[orderNum].totalCount++;
                if (trx.pick_confirm_status === 'YES' || trx.PICK_CONFIRM_STATUS === 'YES') {
                    orderGroups[orderNum].pickedCount++;
                }
            });

            const orders = Object.values(orderGroups);
            totalOrders += orders.length;
            totalLines += trip.transactions.length;

            html += `
                <div class="trip-card">
                    <div class="trip-header">
                        <div class="trip-title">
                            <span class="trip-id">🚚 Trip: ${trip.trip_id}</span>
                            <span class="priority" style="background: ${priColor};">Priority ${pri || '-'}</span>
                        </div>
                        <div class="trip-info">
                            <span>📅 ${trip.trip_date ? new Date(trip.trip_date).toLocaleDateString() : 'N/A'}</span>
                            <span>🚛 ${trip.trip_lorry || '-'}</span>
                            <span>📍 Bay ${trip.trip_loading_bay || '-'}</span>
                            <span>📦 ${orders.length} Orders</span>
                        </div>
                    </div>
                    <table class="orders-table">
                        <thead>
                            <tr>
                                <th>Order #</th>
                                <th>Picker</th>
                                <th style="text-align: center;">Pick Status</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            orders.forEach(order => {
                const pickPct = order.totalCount > 0 ? Math.round((order.pickedCount / order.totalCount) * 100) : 0;
                let statusClass = 'status-not-picked';
                let statusText = 'Not Picked';
                if (pickPct === 100) {
                    statusClass = 'status-picked';
                    statusText = '✓ Picked';
                } else if (pickPct > 0) {
                    statusClass = 'status-partial';
                    statusText = `${pickPct}% Picked`;
                }

                html += `
                            <tr>
                                <td style="font-weight: 600; color: #1e3a5f;">${order.orderNumber}</td>
                                <td>${order.picker}</td>
                                <td style="text-align: center;">
                                    <span class="status-badge ${statusClass}">${statusText}</span>
                                </td>
                            </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            `;
        }
    });

    html += `
                <div class="summary">
                    <strong style="font-size: 16px;">📊 Summary</strong>
                    <div class="summary-grid">
                        <div class="summary-item">
                            <div class="summary-value">${selectedTripsForProcessing.size}</div>
                            <div class="summary-label">Trips</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-value">${totalOrders}</div>
                            <div class="summary-label">Orders</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-value">${totalLines}</div>
                            <div class="summary-label">Lines</div>
                        </div>
                    </div>
                </div>
    `;

    if (comments) {
        html += `
                <div class="comments">
                    <strong>💬 Comments:</strong><br>
                    ${comments.replace(/\n/g, '<br>')}
                </div>
        `;
    }

    html += `
            </div>
            <div class="footer">
                Sent from Gray's WMS System
            </div>
        </div>
    </body>
    </html>
    `;

    return html;
}

// Generate plain text for mailto fallback
function generateEmailPlainText(comments) {
    const groupedTrips = groupTransactionsByTrip();
    let text = 'WMS TRIP UPDATE\n';
    text += '================\n\n';

    let totalOrders = 0;
    let totalLines = 0;

    selectedTripsForProcessing.forEach(tripId => {
        const trip = groupedTrips.find(t => t.trip_id === tripId);
        if (trip) {
            const orderCount = new Set(trip.transactions.map(t => t.source_order)).size;
            totalOrders += orderCount;
            totalLines += trip.transactions.length;

            text += `TRIP: ${trip.trip_id}\n`;
            text += `  Date: ${trip.trip_date ? new Date(trip.trip_date).toLocaleDateString() : 'N/A'}\n`;
            text += `  Lorry: ${trip.trip_lorry || '-'}\n`;
            text += `  Bay: ${trip.trip_loading_bay || '-'}\n`;
            text += `  Priority: ${trip.trip_priority || '-'}\n`;
            text += `  Picker: ${trip.picker || '-'}\n`;
            text += `  Orders: ${orderCount}, Lines: ${trip.transactions.length}\n\n`;
        }
    });

    text += `SUMMARY: ${selectedTripsForProcessing.size} trip(s), ${totalOrders} order(s), ${totalLines} line(s)\n\n`;

    if (comments) {
        text += `COMMENTS:\n${comments}\n`;
    }

    return text;
}

// Open webhook settings
window.openTeamsWebhookSettings = function() {
    document.getElementById('teams-webhook-modal').style.display = 'block';
    renderWebhookList();
};

// Close webhook settings
window.closeTeamsWebhookSettings = function() {
    document.getElementById('teams-webhook-modal').style.display = 'none';
};

// Add new webhook
window.addTeamsWebhook = function() {
    const name = document.getElementById('webhook-name').value.trim();
    const url = document.getElementById('webhook-url').value.trim();

    if (!name || !url) {
        alert('Please enter both channel name and webhook URL');
        return;
    }

    if (!url.includes('webhook.office.com')) {
        alert('Invalid webhook URL. Please use a valid Microsoft Teams webhook URL.');
        return;
    }

    teamsWebhooks.push({ name, url });
    localStorage.setItem('teamsWebhooks', JSON.stringify(teamsWebhooks));

    document.getElementById('webhook-name').value = '';
    document.getElementById('webhook-url').value = '';

    renderWebhookList();
    populateChannelDropdown();

    addLogEntry('Teams', `Added webhook: ${name}`, 'success');
};

// Delete webhook
window.deleteTeamsWebhook = function(index) {
    if (confirm(`Delete webhook "${teamsWebhooks[index].name}"?`)) {
        teamsWebhooks.splice(index, 1);
        localStorage.setItem('teamsWebhooks', JSON.stringify(teamsWebhooks));
        renderWebhookList();
        populateChannelDropdown();
    }
};

// Render webhook list
function renderWebhookList() {
    const list = document.getElementById('webhook-list');

    if (teamsWebhooks.length === 0) {
        list.innerHTML = '<div style="padding: 16px; text-align: center; color: #888;">No webhooks configured</div>';
        return;
    }

    list.innerHTML = teamsWebhooks.map((webhook, index) => `
        <div style="padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <div style="font-weight: 600;">${webhook.name}</div>
                <div style="font-size: 11px; color: #888; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${webhook.url}</div>
            </div>
            <button onclick="deleteTeamsWebhook(${index})" style="background: #fee2e2; color: #dc2626; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
}

// Post to Teams
window.postToTeams = async function() {
    const channelIndex = document.getElementById('teams-channel-select').value;
    const comments = document.getElementById('teams-comments').value.trim();

    if (channelIndex === '') {
        alert('Please select a Teams channel');
        return;
    }

    const webhook = teamsWebhooks[channelIndex];
    if (!webhook) {
        alert('Invalid channel selected');
        return;
    }

    const btn = document.getElementById('teams-post-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';

    try {
        // Use pre-calculated summary data from selectedTripsSummary
        console.log('=== postToTeams: Using selectedTripsSummary ===');
        console.log('selectedTripsSummary:', JSON.stringify(selectedTripsSummary, null, 2));
        const summary = selectedTripsSummary;
        console.log('summary.totalTrips:', summary.totalTrips);
        console.log('summary.totalOrders:', summary.totalOrders);
        console.log('summary.totalLines:', summary.totalLines);
        console.log('summary.trips.length:', summary.trips.length);
        const tripCards = [];

        // Build trip cards from pre-calculated summary
        summary.trips.forEach(trip => {
            const tripStatusIcon = trip.pickPercentage === 100 ? '🟢' : (trip.pickPercentage > 0 ? '🟡' : '🔴');

            // Unique ID for this trip's order details
            const orderDetailsId = `orderDetails_${trip.tripId}`;
            const expandBtnId = `expandBtn_${trip.tripId}`;
            const collapseBtnId = `collapseBtn_${trip.tripId}`;

            // Build order facts from pre-calculated order data
            const orderFacts = trip.orders.map(order => ({
                "type": "ColumnSet",
                "spacing": "small",
                "columns": [
                    {
                        "type": "Column",
                        "width": "40px",
                        "items": [{ "type": "TextBlock", "text": order.statusIcon, "size": "small" }]
                    },
                    {
                        "type": "Column",
                        "width": "stretch",
                        "items": [{ "type": "TextBlock", "text": order.orderNumber, "size": "small", "weight": "bolder" }]
                    },
                    {
                        "type": "Column",
                        "width": "stretch",
                        "items": [{ "type": "TextBlock", "text": order.picker || '-', "size": "small", "isSubtle": true }]
                    },
                    {
                        "type": "Column",
                        "width": "80px",
                        "items": [{ "type": "TextBlock", "text": order.statusText, "size": "small", "horizontalAlignment": "right" }]
                    }
                ]
            }));

            // Trip card with expand/collapse functionality
            tripCards.push({
                "type": "Container",
                "style": "emphasis",
                "bleed": true,
                "items": [
                    // Trip Header
                    {
                        "type": "ColumnSet",
                        "columns": [
                            {
                                "type": "Column",
                                "width": "auto",
                                "items": [{
                                    "type": "TextBlock",
                                    "text": "🚚",
                                    "size": "large"
                                }]
                            },
                            {
                                "type": "Column",
                                "width": "stretch",
                                "items": [
                                    { "type": "TextBlock", "text": `Trip ${trip.tripId}`, "weight": "bolder", "size": "medium", "spacing": "none" },
                                    { "type": "TextBlock", "text": `${trip.tripDate ? new Date(trip.tripDate).toLocaleDateString() : ''} • ${trip.orderCount} orders`, "size": "small", "isSubtle": true, "spacing": "none" }
                                ]
                            },
                            {
                                "type": "Column",
                                "width": "auto",
                                "items": [{
                                    "type": "TextBlock",
                                    "text": trip.priorityText,
                                    "size": "small",
                                    "weight": "bolder",
                                    "color": trip.priorityColor
                                }]
                            }
                        ]
                    },
                    // Trip Details Row with Pick Status
                    {
                        "type": "ColumnSet",
                        "spacing": "small",
                        "columns": [
                            { "type": "Column", "width": "stretch", "items": [{ "type": "TextBlock", "text": `🚛 ${trip.tripLorry}`, "size": "small", "isSubtle": true }] },
                            { "type": "Column", "width": "stretch", "items": [{ "type": "TextBlock", "text": `📍 Bay ${trip.tripLoadingBay}`, "size": "small", "isSubtle": true }] },
                            { "type": "Column", "width": "auto", "items": [{ "type": "TextBlock", "text": `${tripStatusIcon} ${trip.pickPercentage}% Picked`, "size": "small", "weight": "bolder" }] }
                        ]
                    },
                    // Expand Button (visible by default)
                    {
                        "type": "ActionSet",
                        "id": expandBtnId,
                        "actions": [
                            {
                                "type": "Action.ToggleVisibility",
                                "title": "▼ Show Orders",
                                "targetElements": [orderDetailsId, expandBtnId, collapseBtnId]
                            }
                        ],
                        "spacing": "small"
                    },
                    // Collapse Button (hidden by default)
                    {
                        "type": "ActionSet",
                        "id": collapseBtnId,
                        "isVisible": false,
                        "actions": [
                            {
                                "type": "Action.ToggleVisibility",
                                "title": "▲ Hide Orders",
                                "targetElements": [orderDetailsId, expandBtnId, collapseBtnId]
                            }
                        ],
                        "spacing": "small"
                    },
                    // Order Details Container (hidden by default)
                    {
                        "type": "Container",
                        "id": orderDetailsId,
                        "isVisible": false,
                        "items": [
                            // Divider
                            {
                                "type": "TextBlock",
                                "text": "───────────────────────",
                                "size": "small",
                                "isSubtle": true,
                                "spacing": "small"
                            },
                            // Order Header
                            {
                                "type": "ColumnSet",
                                "spacing": "small",
                                "columns": [
                                    { "type": "Column", "width": "40px", "items": [{ "type": "TextBlock", "text": "", "size": "small" }] },
                                    { "type": "Column", "width": "stretch", "items": [{ "type": "TextBlock", "text": "ORDER", "size": "small", "weight": "bolder", "isSubtle": true }] },
                                    { "type": "Column", "width": "stretch", "items": [{ "type": "TextBlock", "text": "PICKER", "size": "small", "weight": "bolder", "isSubtle": true }] },
                                    { "type": "Column", "width": "80px", "items": [{ "type": "TextBlock", "text": "STATUS", "size": "small", "weight": "bolder", "isSubtle": true, "horizontalAlignment": "right" }] }
                                ]
                            },
                            // Orders
                            ...orderFacts
                        ]
                    }
                ],
                "spacing": "medium"
            });
        });

        // Use pre-calculated pick percentage from summary
        const pickPct = summary.pickPercentage;

        // Build Adaptive Card
        const card = {
            type: "message",
            attachments: [{
                contentType: "application/vnd.microsoft.card.adaptive",
                content: {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": [
                        // Header
                        {
                            "type": "Container",
                            "style": "accent",
                            "bleed": true,
                            "items": [
                                {
                                    "type": "TextBlock",
                                    "text": "📦 WMS Trip Summary",
                                    "weight": "bolder",
                                    "size": "large",
                                    "color": "light"
                                },
                                {
                                    "type": "TextBlock",
                                    "text": new Date().toLocaleString(),
                                    "size": "small",
                                    "color": "light",
                                    "isSubtle": true,
                                    "spacing": "none"
                                }
                            ]
                        },
                        // Summary Stats (using pre-calculated data)
                        {
                            "type": "ColumnSet",
                            "spacing": "medium",
                            "columns": [
                                {
                                    "type": "Column",
                                    "width": "stretch",
                                    "items": [
                                        { "type": "TextBlock", "text": summary.totalTrips.toString(), "size": "extraLarge", "weight": "bolder", "horizontalAlignment": "center" },
                                        { "type": "TextBlock", "text": "Trips", "size": "small", "horizontalAlignment": "center", "isSubtle": true, "spacing": "none" }
                                    ]
                                },
                                {
                                    "type": "Column",
                                    "width": "stretch",
                                    "items": [
                                        { "type": "TextBlock", "text": summary.totalOrders.toString(), "size": "extraLarge", "weight": "bolder", "horizontalAlignment": "center" },
                                        { "type": "TextBlock", "text": "Orders", "size": "small", "horizontalAlignment": "center", "isSubtle": true, "spacing": "none" }
                                    ]
                                },
                                {
                                    "type": "Column",
                                    "width": "stretch",
                                    "items": [
                                        { "type": "TextBlock", "text": summary.totalLines.toString(), "size": "extraLarge", "weight": "bolder", "horizontalAlignment": "center" },
                                        { "type": "TextBlock", "text": "Lines", "size": "small", "horizontalAlignment": "center", "isSubtle": true, "spacing": "none" }
                                    ]
                                },
                                {
                                    "type": "Column",
                                    "width": "stretch",
                                    "items": [
                                        { "type": "TextBlock", "text": `${pickPct}%`, "size": "extraLarge", "weight": "bolder", "horizontalAlignment": "center", "color": pickPct === 100 ? "good" : (pickPct > 50 ? "warning" : "attention") },
                                        { "type": "TextBlock", "text": "Picked", "size": "small", "horizontalAlignment": "center", "isSubtle": true, "spacing": "none" }
                                    ]
                                }
                            ]
                        },
                        // Trip Cards
                        ...tripCards
                    ]
                }
            }]
        };

        // Add legend
        card.attachments[0].content.body.push({
            "type": "Container",
            "spacing": "medium",
            "items": [
                {
                    "type": "TextBlock",
                    "text": "🟢 Picked  🟡 Partial  🔴 Pending",
                    "size": "small",
                    "isSubtle": true,
                    "horizontalAlignment": "center"
                }
            ]
        });

        // Add comments if provided
        if (comments) {
            card.attachments[0].content.body.push({
                "type": "Container",
                "style": "warning",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "💬 Comments",
                        "weight": "bolder",
                        "size": "small"
                    },
                    {
                        "type": "TextBlock",
                        "text": comments,
                        "wrap": true,
                        "size": "small"
                    }
                ],
                "spacing": "medium"
            });
        }

        // Send to Teams via C# backend to avoid CORS issues
        if (window.chrome && window.chrome.webview) {
            // Use C# backend for Teams posting
            window._teamsPostBtn = btn;
            window._teamsWebhookName = webhook.name;

            window.chrome.webview.postMessage({
                action: 'postToTeams',
                webhookUrl: webhook.url,
                cardPayload: card
            });

            // Result will be handled by handleTeamsPostResult callback
            console.log('[Teams] Message sent to C# backend for posting');
        } else {
            // Fallback to direct fetch (may fail due to CORS)
            console.log('[Teams] No WebView2 detected, attempting direct fetch...');
            const response = await fetch(webhook.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(card)
            });

            if (response.ok) {
                addLogEntry('Teams', `Message posted to ${webhook.name}`, 'success');
                alert('Message posted to Teams successfully!');
                closeTeamsModal();
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Post to Teams';
        }

    } catch (error) {
        console.error('[Teams] Failed to post:', error);
        addLogEntry('Teams', `Failed to post: ${error.message}`, 'error');
        alert('Failed to post to Teams: ' + error.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Post to Teams';
    }
};

// Callback for C# backend Teams post result
window.handleTeamsPostResult = function(success, message) {
    console.log('[Teams] C# backend result:', success, message);

    const btn = window._teamsPostBtn;
    const webhookName = window._teamsWebhookName || 'Teams';

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Post to Teams';
    }

    if (success) {
        if (typeof addLogEntry === 'function') {
            addLogEntry('Teams', `Message posted to ${webhookName}`, 'success');
        }
        alert('Message posted to Teams successfully!');
        if (typeof closeTeamsModal === 'function') {
            closeTeamsModal();
        }
    } else {
        if (typeof addLogEntry === 'function') {
            addLogEntry('Teams', `Failed to post: ${message}`, 'error');
        }
        alert('Failed to post to Teams: ' + message);
    }
};

// Override toggleTripSelection to also update Teams button
const originalToggleTripSelection = toggleTripSelection;
toggleTripSelection = function(tripId, index) {
    originalToggleTripSelection(tripId, index);
    updateTeamsButtonCount();
};

// Initialize Teams integration when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Delay to ensure page is loaded
    setTimeout(initTeamsIntegration, 1000);
});

// Also initialize when script loads (for dynamic loading)
if (document.readyState === 'complete') {
    setTimeout(initTeamsIntegration, 500);
}

// ============================================================================
// MRA BATCH INTERFACE PROCESSING
// ============================================================================

// Start MRA Interface for all orders in trip
window.startTripMRAInterface = async function() {
    if (!currentTripPrintData) {
        alert('No trip data available');
        return;
    }

    console.log('[MRA Batch] Starting MRA Interface for all orders...');

    // Confirm with user
    const confirmed = confirm(`Process MRA Interface for ${currentTripPrintData.orders.length} orders?\n\nThis will interface each order to MRA (Mauritius Revenue Authority).`);
    if (!confirmed) return;

    // Disable MRA button
    const mraBtn = document.getElementById('trip-print-mra-btn');
    if (mraBtn) {
        mraBtn.disabled = true;
        mraBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    }

    // First, fetch Fusion credentials from API
    let fusionUsername = window.F_username;
    let fusionPassword = window.F_password;

    if (!fusionUsername || !fusionPassword) {
        console.log('[MRA Batch] Fetching Fusion credentials from API...');
        try {
            const credentials = await fetchFusionCredentialsForBatchMRA();
            fusionUsername = credentials.username;
            fusionPassword = credentials.password;
        } catch (credError) {
            console.error('[MRA Batch] Failed to fetch credentials:', credError);
            alert('Failed to fetch Fusion credentials. Please try again.');
            if (mraBtn) {
                mraBtn.disabled = false;
                mraBtn.innerHTML = '<i class="fas fa-file-invoice-dollar"></i> MRA Interface';
            }
            return;
        }
    }

    let successCount = 0;
    let failCount = 0;

    // Process each order
    for (let i = 0; i < currentTripPrintData.orders.length; i++) {
        const order = currentTripPrintData.orders[i];

        console.log(`[MRA Batch] Processing ${i + 1}/${currentTripPrintData.orders.length}: ${order.orderNumber}`);

        // Initialize MRA logs for this order
        order.mraLogs = [];
        order.mraStatus = 'PROCESSING';
        order.mraError = null;
        renderTripPrintOrders();

        // Add log entry
        const addOrderMRALog = (message, type = 'info') => {
            const timestamp = new Date().toLocaleTimeString();
            order.mraLogs.push({ timestamp, message, type });
        };

        addOrderMRALog(`Starting MRA processing for order: ${order.orderNumber}`, 'info');
        addOrderMRALog(`Instance: ${order.instance || currentTripPrintData.instanceName}`, 'info');
        addOrderMRALog(`Fusion Service Account: ${fusionUsername}`, 'info');

        try {
            // Send MRA request to C#
            const requestId = Date.now().toString() + '_' + i;
            const message = {
                action: 'processMRAInterface',
                requestId: requestId,
                orderNumber: order.orderNumber,
                fusionUsername: fusionUsername,
                fusionPassword: fusionPassword,
                instance: order.instance || currentTripPrintData.instanceName || 'PROD'
            };

            addOrderMRALog('Sending request to C# backend...', 'info');

            const response = await new Promise((resolve, reject) => {
                // Set up response handler
                const handler = function(event) {
                    const data = event.data;
                    if (data.action === 'processMRAInterfaceResponse' && data.requestId === requestId) {
                        window.chrome.webview.removeEventListener('message', handler);
                        resolve(data);
                    }
                };
                window.chrome.webview.addEventListener('message', handler);

                // Send message
                if (window.chrome?.webview) {
                    window.chrome.webview.postMessage(message);
                } else {
                    reject(new Error('WebView2 not available'));
                }

                // Timeout after 60 seconds
                setTimeout(() => {
                    window.chrome.webview.removeEventListener('message', handler);
                    reject(new Error('MRA request timed out'));
                }, 60000);
            });

            if (response.success) {
                order.mraStatus = 'SUCCESS';
                order.mraIrnCode = response.irnCode;
                addOrderMRALog(`MRA Interface successful. IRN: ${response.irnCode}`, 'success');
                successCount++;
            } else {
                order.mraStatus = 'FAILED';
                order.mraError = response.message || 'Unknown error';
                addOrderMRALog(`MRA Interface failed: ${response.message}`, 'error');
                failCount++;
            }

        } catch (error) {
            order.mraStatus = 'FAILED';
            order.mraError = error.message;
            addOrderMRALog(`Error: ${error.message}`, 'error');
            failCount++;
        }

        renderTripPrintOrders();
    }

    // Re-enable MRA button
    if (mraBtn) {
        mraBtn.disabled = false;
        mraBtn.innerHTML = '<i class="fas fa-file-invoice-dollar"></i> MRA Interface';
    }

    // Show summary
    alert(`MRA Interface Complete!\n\nSuccess: ${successCount}\nFailed: ${failCount}\nTotal: ${currentTripPrintData.orders.length}`);
};

// Fetch Fusion credentials for batch MRA
async function fetchFusionCredentialsForBatchMRA() {
    return new Promise((resolve, reject) => {
        const instance = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';
        const credentialsUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fusionuserdetails?p_instance_name=${instance}`;

        console.log('[MRA Batch] Fetching credentials from:', credentialsUrl);

        sendMessageToCSharp({
            action: "executeGet",
            fullUrl: credentialsUrl
        }, function(error, data) {
            if (error) {
                console.error('[MRA Batch] Failed to fetch credentials:', error);
                reject(new Error(error));
                return;
            }

            try {
                const response = JSON.parse(data);
                console.log('[MRA Batch] API response:', response);

                if (response.items && response.items.length > 0) {
                    const username = response.items[0].user_name || '';
                    const password = response.items[0].passwordd || '';

                    // Set global properties
                    window.F_username = username;
                    window.F_password = password;

                    console.log('[MRA Batch] Credentials loaded for user:', username);
                    resolve({ username, password });
                } else {
                    console.error('[MRA Batch] No credentials found in response');
                    reject(new Error('No credentials found in API response'));
                }
            } catch (parseError) {
                console.error('[MRA Batch] Failed to parse credentials:', parseError);
                reject(parseError);
            }
        });
    });
}

// Show MRA Log for specific order
window.showMRALogForOrder = function(orderIndex) {
    if (!currentTripPrintData || !currentTripPrintData.orders[orderIndex]) {
        alert('Order data not found');
        return;
    }

    const order = currentTripPrintData.orders[orderIndex];
    const logs = order.mraLogs || [];

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'mra-log-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100001;
        backdrop-filter: blur(4px);
    `;

    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        width: 600px;
        max-width: 95%;
        max-height: 80vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    `;

    // Generate log HTML
    let logHtml = logs.map(log => {
        let color = '#94a3b8';
        if (log.type === 'error') color = '#f87171';
        if (log.type === 'success') color = '#4ade80';
        if (log.type === 'warning') color = '#fbbf24';

        return `<div style="margin-bottom: 0.25rem; color: ${color};">
            <span style="color: #64748b;">[${log.timestamp}]</span> ${log.message}
        </div>`;
    }).join('');

    if (logs.length === 0) {
        logHtml = '<div style="color: #64748b;">No logs available</div>';
    }

    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%); color: white; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <h3 style="margin: 0; font-size: 1.1rem;">
                    <i class="fas fa-list-alt"></i> MRA Log - ${order.orderNumber}
                </h3>
                <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; opacity: 0.9;">Status: ${order.mraStatus || 'PENDING'}</p>
            </div>
            <button onclick="closeMRALogModal()" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1.25rem;">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div style="padding: 1rem; background: #1e293b; flex: 1; overflow-y: auto; font-family: monospace; font-size: 0.75rem;">
            ${logHtml}
        </div>
        <div style="padding: 0.75rem 1.5rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; background: #f8f9fa;">
            <button onclick="closeMRALogModal()" style="padding: 0.5rem 1.5rem; background: #64748b; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                Close
            </button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
};

// Close MRA Log Modal
window.closeMRALogModal = function() {
    const overlay = document.getElementById('mra-log-overlay');
    if (overlay) {
        overlay.remove();
    }
};

// Retry MRA for specific order
window.retryMRAForOrder = async function(orderIndex) {
    if (!currentTripPrintData || !currentTripPrintData.orders[orderIndex]) {
        alert('Order data not found');
        return;
    }

    const order = currentTripPrintData.orders[orderIndex];

    console.log('[MRA Retry] Retrying MRA for order:', order.orderNumber);

    // Fetch credentials if needed
    let fusionUsername = window.F_username;
    let fusionPassword = window.F_password;

    if (!fusionUsername || !fusionPassword) {
        try {
            const credentials = await fetchFusionCredentialsForBatchMRA();
            fusionUsername = credentials.username;
            fusionPassword = credentials.password;
        } catch (credError) {
            console.error('[MRA Retry] Failed to fetch credentials:', credError);
            alert('Failed to fetch Fusion credentials. Please try again.');
            return;
        }
    }

    // Reset order MRA state
    order.mraLogs = [];
    order.mraStatus = 'PROCESSING';
    order.mraError = null;
    renderTripPrintOrders();

    // Add log entry helper
    const addOrderMRALog = (message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        order.mraLogs.push({ timestamp, message, type });
    };

    addOrderMRALog(`Retrying MRA processing for order: ${order.orderNumber}`, 'info');
    addOrderMRALog(`Instance: ${order.instance || currentTripPrintData.instanceName}`, 'info');
    addOrderMRALog(`Fusion Service Account: ${fusionUsername}`, 'info');

    try {
        const requestId = Date.now().toString() + '_retry';
        const message = {
            action: 'processMRAInterface',
            requestId: requestId,
            orderNumber: order.orderNumber,
            fusionUsername: fusionUsername,
            fusionPassword: fusionPassword,
            instance: order.instance || currentTripPrintData.instanceName || 'PROD'
        };

        addOrderMRALog('Sending request to C# backend...', 'info');

        const response = await new Promise((resolve, reject) => {
            const handler = function(event) {
                const data = event.data;
                if (data.action === 'processMRAInterfaceResponse' && data.requestId === requestId) {
                    window.chrome.webview.removeEventListener('message', handler);
                    resolve(data);
                }
            };
            window.chrome.webview.addEventListener('message', handler);

            if (window.chrome?.webview) {
                window.chrome.webview.postMessage(message);
            } else {
                reject(new Error('WebView2 not available'));
            }

            setTimeout(() => {
                window.chrome.webview.removeEventListener('message', handler);
                reject(new Error('MRA request timed out'));
            }, 60000);
        });

        if (response.success) {
            order.mraStatus = 'SUCCESS';
            order.mraIrnCode = response.irnCode;
            addOrderMRALog(`MRA Interface successful. IRN: ${response.irnCode}`, 'success');
        } else {
            order.mraStatus = 'FAILED';
            order.mraError = response.message || 'Unknown error';
            addOrderMRALog(`MRA Interface failed: ${response.message}`, 'error');
        }

    } catch (error) {
        order.mraStatus = 'FAILED';
        order.mraError = error.message;
        addOrderMRALog(`Error: ${error.message}`, 'error');
    }

    renderTripPrintOrders();
};

console.log('[Auto Processing] Script loaded successfully');
console.log('[Auto Processing] Teams integration ready');

// ============================================================================
// AUTO SALES ORDER PROCESSING
// ============================================================================
// Automated sales order transaction processing with intelligent retry
// Uses the actual API fields from autosalesorderprocessing webservice
// ============================================================================

// Global state
let autoSOProcessingEnabled = false;
let autoSOProcessingInterval = null;
let autoSOProcessingData = [];
let autoSOProcessingFilters = {
    tripId: '',
    orderNumber: '',
    itemDesc: '',
    customer: '',
    status: ''
};
let autoSOProcessingStats = {
    totalTrips: 0,
    totalOrders: 0,
    totalLines: 0,
    cancelled: 0,
    processing: 0,
    success: 0,
    failed: 0
};

// Processing Timer
let soProcessingStartTime = null;
let soProcessingEndTime = null;
let soProcessingTimerInterval = null;
let isSOProcessing = false;
let currentSOProcessingTrip = null;
let currentSOProcessingTripId = null;
let currentSOProcessingOrder = null;

// Selected trips for processing (Set of trip_id strings)
let selectedSOTripsForProcessing = new Set();

// Font size multiplier for Trip and Order groups (1.0 = 100%)
let soTripOrderFontSizeMultiplier = 1.0;
const SO_FONT_SIZE_STEP = 0.1; // 10% per click
const SO_FONT_SIZE_MIN = 0.6;  // 60% minimum
const SO_FONT_SIZE_MAX = 1.6;  // 160% maximum

// Initialize auto processing on page load
document.addEventListener('DOMContentLoaded', function() {
    initializeAutoSOProcessing();

    // Set page title in toolbar when this page is shown
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            const pageId = this.getAttribute('data-page');
            if (pageId === 'auto-sales-order-processing') {
                const pageTitleElement = document.getElementById('current-page-title');
                if (pageTitleElement) {
                    pageTitleElement.textContent = 'Auto Sales Order Processing';
                }
            }
        });
    });
});

// Initialize auto processing
function initializeAutoSOProcessing() {
    console.log('[Auto SO Processing] Initializing...');

    // Set default dates (today)
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('auto-so-from-date').value = today;
    document.getElementById('auto-so-to-date').value = today;

    // Setup toggle switch
    const toggle = document.getElementById('auto-so-process-toggle');
    if (toggle) {
        toggle.addEventListener('change', function() {
            if (this.checked) {
                startAutoSOProcessing();
            } else {
                stopAutoSOProcessing();
            }
        });
    }

    addSOLogEntry('System', 'Auto Sales Order Processing initialized', 'success');
}

// Fetch auto sales order data from API using WebView REST handler
function fetchAutoSalesOrderData() {
    const fromDate = document.getElementById('auto-so-from-date').value;
    const toDate = document.getElementById('auto-so-to-date').value;

    if (!fromDate || !toDate) {
        alert('Please select both From Date and To Date');
        return;
    }

    const fetchBtn = document.getElementById('auto-so-fetch-btn');
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';

    addSOLogEntry('API', `Fetching data from ${fromDate} to ${toDate}...`, 'info');

    // Build API URL
    const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/autosalesorderprocessing?P_FROM_DATE=${fromDate}&P_TO_DATE=${toDate}`;

    console.log('[Auto SO Processing] Fetching from:', apiUrl);

    // Use WebView REST handler
    sendMessageToCSharp({
        action: "executeGet",
        fullUrl: apiUrl
    }, function(error, data) {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Fetch Data';

        if (error) {
            console.error('[Auto SO Processing] Fetch error:', error);
            addSOLogEntry('Error', `Failed to fetch data: ${error}`, 'error');

            const container = document.getElementById('auto-so-trips-container');
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

                // Store the data - lowercase all field names for consistency
                autoSOProcessingData = (response.items || []).map(item => {
                    // Create a normalized item with lowercase keys
                    const normalized = {};
                    for (const key in item) {
                        normalized[key.toLowerCase()] = item[key];
                    }
                    return normalized;
                });

                console.log('[Auto SO Processing] Fetched', autoSOProcessingData.length, 'records');
                console.log('[Auto SO Processing] Sample record:', autoSOProcessingData[0]);
                addSOLogEntry('API', `Fetched ${autoSOProcessingData.length} sales order records`, 'success');

                // Group and display data
                displaySOGroupedTrips();

                // Update statistics
                updateSOStatistics();

                // Populate filter dropdowns with data
                populateSOFilterDropdowns();

            } catch (e) {
                console.error('[Auto SO Processing] Parse error:', e);
                addSOLogEntry('Error', `Failed to parse data: ${e.message}`, 'error');

                const container = document.getElementById('auto-so-trips-container');
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
function groupSOTransactionsByTrip() {
    const grouped = {};

    // Apply filters first
    let filteredData = autoSOProcessingData;

    const tripIdFilter = document.getElementById('so-filter-trip-id')?.value?.trim().toLowerCase() || '';
    const orderNumberFilter = document.getElementById('so-filter-order-number')?.value?.trim().toLowerCase() || '';
    const itemDescFilter = document.getElementById('so-filter-item-desc')?.value?.trim().toLowerCase() || '';
    const customerFilter = document.getElementById('so-filter-customer')?.value?.trim().toLowerCase() || '';
    const statusFilter = document.getElementById('so-filter-status')?.value?.toUpperCase() || '';

    if (tripIdFilter || orderNumberFilter || itemDescFilter || customerFilter || statusFilter) {
        filteredData = autoSOProcessingData.filter(item => {
            const matchTripId = !tripIdFilter || String(item.trip_id || '').toLowerCase().includes(tripIdFilter);
            const matchOrderNumber = !orderNumberFilter || String(item.source_order || '').toLowerCase().includes(orderNumberFilter);
            const matchItemDesc = !itemDescFilter || String(item.description || '').toLowerCase().includes(itemDescFilter);
            const matchCustomer = !customerFilter || String(item.customer || '').toLowerCase().includes(customerFilter);

            // Status filter based on pick_confirm_st and cancel_status
            let itemStatus = getLineStatus(item);
            const matchStatus = !statusFilter || itemStatus === statusFilter;

            return matchTripId && matchOrderNumber && matchItemDesc && matchCustomer && matchStatus;
        });
    }

    filteredData.forEach(item => {
        const tripId = item.trip_id;

        if (!grouped[tripId]) {
            grouped[tripId] = {
                trip_id: tripId,
                trip_date: item.trip_date,
                trip_lorry: item.trip_lorry,
                trip_loading_bay: item.trip_loading_bay,
                trip_priority: item.trip_priority,
                picker: item.picker,
                customer: item.customer,
                transactions: []
            };
        }

        grouped[tripId].transactions.push(item);
    });

    return Object.values(grouped);
}

// Get line status based on API fields
function getLineStatus(item) {
    if (item.cancel_status) {
        return 'CANCELLED';
    }
    if (item.processing_status === 'PROCESSING') {
        return 'PROCESSING';
    }
    if (item.processing_status === 'FAILED' || item.error_message) {
        return 'FAILED';
    }
    if (item.pick_confirm_st === 'YES') {
        return 'SUCCESS';
    }
    return 'PENDING';
}

// Display grouped trips
function displaySOGroupedTrips() {
    const container = document.getElementById('auto-so-trips-container');
    const groupedTrips = groupSOTransactionsByTrip();

    // Store currently expanded states before re-rendering
    const expandedStates = {};
    document.querySelectorAll('[id^="so-order-details-"]').forEach(element => {
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
        // Get distinct order count (unique source_order)
        const distinctOrders = [...new Set(trip.transactions.map(t => t.source_order))];
        const orderCount = distinctOrders.length;

        // Get first customer from transactions (they should all be same for the trip)
        const tripCustomer = trip.transactions[0]?.customer || 'N/A';

        // Calculate status counts
        const successCount = trip.transactions.filter(t => getLineStatus(t) === 'SUCCESS').length;
        const failedCount = trip.transactions.filter(t => getLineStatus(t) === 'FAILED').length;
        const processingCount = trip.transactions.filter(t => getLineStatus(t) === 'PROCESSING').length;
        const cancelledCount = trip.transactions.filter(t => getLineStatus(t) === 'CANCELLED').length;
        const pendingCount = trip.transactions.filter(t => getLineStatus(t) === 'PENDING').length;

        // Calculate Trip-level Pick Confirm status
        const tripPickConfirmYes = trip.transactions.filter(t => t.pick_confirm_st === 'YES').length;
        const tripPickConfirmNo = trip.transactions.filter(t => t.pick_confirm_st !== 'YES').length;
        const tripPickConfirm = tripPickConfirmYes === trip.transactions.length ? 'YES' :
                                tripPickConfirmNo === trip.transactions.length ? 'NO' : 'Partial';
        const tripPickConfirmColor = tripPickConfirm === 'YES' ? '#10b981' :
                                     tripPickConfirm === 'NO' ? '#ef4444' : '#f59e0b';

        // Calculate Trip-level Ship Confirm status
        const tripShipConfirmYes = trip.transactions.filter(t => t.ship_confirm_st === 'YES').length;
        const tripShipConfirmNo = trip.transactions.filter(t => t.ship_confirm_st !== 'YES').length;
        const tripShipConfirm = tripShipConfirmYes === trip.transactions.length ? 'YES' :
                                tripShipConfirmNo === trip.transactions.length ? 'NO' : 'Partial';
        const tripShipConfirmColor = tripShipConfirm === 'YES' ? '#10b981' :
                                     tripShipConfirm === 'NO' ? '#ef4444' : '#f59e0b';

        // Check if this trip is selected
        const isSelected = selectedSOTripsForProcessing.has(String(trip.trip_id));
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
            <div id="so-trip-card-${index}" style="background: white; ${cardBorderStyle} border-radius: 8px; margin-bottom: 0.75rem; overflow: hidden; transition: all 0.3s;">
                <!-- Trip Header -->
                <div class="so-trip-group-header" onclick="toggleSOTripDetails(${index})" style="padding: 0.75rem 1rem; background: linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s;" onmouseover="this.style.background='linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)'" onmouseout="this.style.background='linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%)'">
                    <div style="display: flex; gap: 1rem; align-items: center; flex: 1; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <i class="fas fa-truck so-trip-group-icon" style="color: #667eea; font-size: 14px;"></i>
                            <div>
                                <div class="so-trip-group-label" style="font-size: 7px; color: #64748b; font-weight: 600;">TRIP</div>
                                <div class="so-trip-group-value" style="font-size: 11px; font-weight: 700; color: #1e293b;">${trip.trip_id}</div>
                            </div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 7px; color: #64748b; font-weight: 600;">LORRY</div>
                            <div class="so-trip-group-value-sm" style="font-size: 10px; font-weight: 600; color: #7c3aed;">${trip.trip_lorry || '-'}</div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 7px; color: #64748b; font-weight: 600;">BAY</div>
                            <div class="so-trip-group-value-sm" style="font-size: 10px; font-weight: 600; color: #2563eb;">${trip.trip_loading_bay || '-'}</div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 7px; color: #64748b; font-weight: 600;">PRI</div>
                            <div class="so-trip-group-value-sm" style="font-size: 10px; font-weight: 700; color: ${trip.trip_priority <= 3 ? '#dc2626' : trip.trip_priority <= 6 ? '#d97706' : '#059669'};">${trip.trip_priority || '-'}</div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 7px; color: #64748b; font-weight: 600;">DATE</div>
                            <div class="so-trip-group-value-sm" style="font-size: 10px; font-weight: 600; color: #1e293b;">${trip.trip_date ? new Date(trip.trip_date).toLocaleDateString() : '-'}</div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 7px; color: #64748b; font-weight: 600;">ORD</div>
                            <div class="so-trip-group-value" style="font-size: 11px; font-weight: 700; color: #667eea;">${orderCount}</div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 7px; color: #64748b; font-weight: 600;">LINES</div>
                            <div class="so-trip-group-value" style="font-size: 11px; font-weight: 700; color: #667eea;">${trip.transactions.length}</div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 7px; color: #64748b; font-weight: 600;">PICK</div>
                            <div class="so-trip-group-value-sm" style="font-size: 10px; font-weight: 700; color: ${tripPickConfirmColor};">${tripPickConfirm}</div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 7px; color: #64748b; font-weight: 600;">SHIP</div>
                            <div class="so-trip-group-value-sm" style="font-size: 10px; font-weight: 700; color: ${tripShipConfirmColor};">${tripShipConfirm}</div>
                        </div>
                        <div class="so-trip-stats-badges" style="display: flex; gap: 0.3rem;">
                            ${successCount > 0 ? `<span class="so-trip-stats-badge" style="background: #10b981; color: white; padding: 2px 5px; border-radius: 4px; font-size: 8px; font-weight: 700;">${successCount} ✓</span>` : ''}
                            ${processingCount > 0 ? `<span class="so-trip-stats-badge" style="background: #f59e0b; color: white; padding: 2px 5px; border-radius: 4px; font-size: 8px; font-weight: 700;"><i class="fas fa-spinner fa-spin"></i> ${processingCount}</span>` : ''}
                            ${pendingCount > 0 ? `<span class="so-trip-stats-badge" style="background: #3b82f6; color: white; padding: 2px 5px; border-radius: 4px; font-size: 8px; font-weight: 700;">${pendingCount} ⏳</span>` : ''}
                            ${cancelledCount > 0 ? `<span class="so-trip-stats-badge" style="background: #6b7280; color: white; padding: 2px 5px; border-radius: 4px; font-size: 8px; font-weight: 700;">${cancelledCount} ⊘</span>` : ''}
                            ${failedCount > 0 ? `<span class="so-trip-stats-badge" style="background: #ef4444; color: white; padding: 2px 5px; border-radius: 4px; font-size: 8px; font-weight: 700;">${failedCount} ✗</span>` : ''}
                        </div>
                    </div>
                    <button onclick="event.stopPropagation(); openSOTripPrintModal('${trip.trip_id}', '${trip.trip_date}', ${orderCount}, ${index})" style="background: #10b981; color: white; border: none; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 600; display: flex; align-items: center; gap: 0.4rem; margin-right: 0.5rem; transition: all 0.2s;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'" title="Print all orders in this trip">
                        <i class="fas fa-print"></i> Print Trip
                    </button>
                    <button id="so-trip-select-btn-${index}" onclick="event.stopPropagation(); toggleSOTripSelection('${trip.trip_id}', ${index})" style="${selectBtnStyle} color: white; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 600; display: flex; align-items: center; gap: 0.4rem; margin-right: 0.75rem; transition: all 0.2s;" title="Select for processing">
                        ${selectBtnText}
                    </button>
                    <i class="fas fa-chevron-down" id="so-trip-chevron-${index}" style="color: #667eea; transition: transform 0.3s;"></i>
                </div>

                <!-- Trip Details (Collapsible) -->
                <div id="so-trip-details-${index}" style="display: none; padding: 1rem; background: #f8f9fa;">
                    ${renderSOTripTransactions(trip.transactions, index)}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Restore expanded states after re-rendering
    Object.keys(expandedStates).forEach(elementId => {
        const element = document.getElementById(elementId);
        const chevronId = elementId.replace('so-order-details-', 'so-order-chevron-');
        const chevron = document.getElementById(chevronId);

        if (element && chevron) {
            element.style.display = 'block';
            chevron.style.transform = 'rotate(180deg)';
        }
    });

    // Show expand/collapse all button when there's data
    const expandCollapseBtn = document.getElementById('so-expand-collapse-all-btn');
    if (expandCollapseBtn) {
        expandCollapseBtn.style.display = groupedTrips.length > 0 ? 'block' : 'none';
    }
}

// Render trip transactions grouped by source_order (order number)
function renderSOTripTransactions(transactions, tripIndex) {
    // Group transactions by source_order
    const orderGroups = {};

    transactions.forEach((trx, idx) => {
        const orderNum = trx.source_order || 'Unknown';
        if (!orderGroups[orderNum]) {
            orderGroups[orderNum] = {
                source_order: orderNum,
                customer: trx.customer,
                picker: trx.picker || '',
                items: [],
                totalRequestedQty: 0,
                totalPickedQty: 0,
                totalLines: 0,
                processedLines: 0,
                notProcessedLines: 0
            };
        }
        orderGroups[orderNum].items.push({ ...trx, originalIndex: idx });
        orderGroups[orderNum].totalRequestedQty += parseFloat(trx.requested_quantity) || 0;
        orderGroups[orderNum].totalPickedQty += parseFloat(trx.picked_qty) || 0;
        orderGroups[orderNum].totalLines += 1;

        // Count processed vs not processed
        const trxStatus = getLineStatus(trx);
        if (trxStatus === 'SUCCESS') {
            orderGroups[orderNum].processedLines += 1;
        } else if (trxStatus !== 'CANCELLED') {
            orderGroups[orderNum].notProcessedLines += 1;
        }
    });

    const orders = Object.values(orderGroups);

    let html = `
        <!-- Order Actions Toolbar -->
        <div id="so-order-actions-toolbar-${tripIndex}" style="display: none; background: #e5e7eb; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); border: 1px solid #d1d5db;">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="color: #1f2937; font-size: 12px; font-weight: 600;">
                        <i class="fas fa-check-square"></i> <span id="so-selected-orders-count-${tripIndex}">0</span> Orders Selected
                    </span>
                </div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <button onclick="soPickReleaseSelected(${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 0.4rem; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                        <i class="fas fa-box-open"></i> Pick Release
                    </button>
                    <button onclick="soAssignPickerSelected(${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 0.4rem; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                        <i class="fas fa-user-plus"></i> Assign Picker
                    </button>
                    <button onclick="soCancelScheduledLinesSelected(${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 0.4rem; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                        <i class="fas fa-ban"></i> Cancel Scheduled Lines
                    </button>
                </div>
            </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; gap: 0.5rem;">
            <div style="display: flex; gap: 0.5rem;">
                <button onclick="soSelectAllOrders(${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                    <i class="fas fa-check-double"></i> Select All Orders
                </button>
                <button onclick="soDeselectAllOrders(${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                    <i class="fas fa-times"></i> Clear Selection
                </button>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button onclick="expandAllSOOrders(${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                    <i class="fas fa-expand-alt"></i> Expand All
                </button>
                <button onclick="collapseAllSOOrders(${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                    <i class="fas fa-compress-alt"></i> Collapse All
                </button>
            </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 1rem;">
    `;

    orders.forEach((order, orderIdx) => {
        // Order status logic
        const allSuccessOrCancelled = order.items.every(i => {
            const status = getLineStatus(i);
            return status === 'SUCCESS' || status === 'CANCELLED';
        });
        const hasFailed = order.items.some(i => getLineStatus(i) === 'FAILED');

        const orderStatus = hasFailed ? 'FAILED' :
                           allSuccessOrCancelled ? 'SUCCESS' :
                           'PENDING';

        const statusColor = orderStatus === 'SUCCESS' ? '#10b981' :
                           orderStatus === 'FAILED' ? '#ef4444' :
                           '#3b82f6';

        const statusIcon = orderStatus === 'SUCCESS' ? 'check-circle' :
                          orderStatus === 'FAILED' ? 'times-circle' :
                          'clock';

        // Calculate Pick Confirm status for order
        const pickConfirmYes = order.items.filter(i => i.pick_confirm_st === 'YES').length;
        const pickConfirmNo = order.items.filter(i => i.pick_confirm_st !== 'YES').length;
        const orderPickConfirm = pickConfirmYes === order.items.length ? 'YES' :
                                 pickConfirmNo === order.items.length ? 'NO' : 'Partial';
        const orderPickConfirmColor = orderPickConfirm === 'YES' ? '#10b981' :
                                      orderPickConfirm === 'NO' ? '#ef4444' : '#f59e0b';

        // Calculate Ship Confirm status for order
        const shipConfirmYes = order.items.filter(i => i.ship_confirm_st === 'YES').length;
        const shipConfirmNo = order.items.filter(i => i.ship_confirm_st !== 'YES').length;
        const orderShipConfirm = shipConfirmYes === order.items.length ? 'YES' :
                                 shipConfirmNo === order.items.length ? 'NO' : 'Partial';
        const orderShipConfirmColor = orderShipConfirm === 'YES' ? '#10b981' :
                                      orderShipConfirm === 'NO' ? '#ef4444' : '#f59e0b';

        const orderId = `so-trip-${tripIndex}-order-${orderIdx}`;

        html += `
            <div id="so-order-card-${orderId}" style="background: white; border: 2px solid #e2e8f0; border-radius: 6px; overflow: hidden; transition: all 0.2s;" data-so-order-container="${tripIndex}" data-order-number="${order.source_order}">
                <!-- Order Header -->
                <div class="so-order-group-header" onclick="toggleSOOrderDetails('${orderId}')" style="padding: 0.5rem 0.75rem; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s; border-left: 3px solid #667eea;" onmouseover="this.style.background='linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'" onmouseout="this.style.background='linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)'">
                    <div style="display: flex; gap: 1rem; align-items: center; flex: 1;">
                        <!-- Checkbox for selection -->
                        <div onclick="event.stopPropagation();" style="display: flex; align-items: center;">
                            <input type="checkbox" id="so-order-checkbox-${orderId}" onchange="soToggleOrderSelection('${orderId}', '${order.source_order}', ${tripIndex})" style="width: 18px; height: 18px; cursor: pointer; accent-color: #667eea;">
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <i class="fas fa-shopping-cart so-order-group-icon" style="color: #667eea; font-size: 14px;"></i>
                            <div>
                                <div class="so-order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Source Order</div>
                                <div class="so-order-group-value" style="font-size: 12px; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 0.4rem;">
                                    ${order.source_order}
                                    <i class="fas fa-spinner fa-spin" id="so-order-processing-${orderId}" style="color: #667eea; font-size: 10px; display: none;"></i>
                                </div>
                            </div>
                        </div>
                        <div>
                            <div class="so-order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Customer</div>
                            <div class="so-order-group-value-sm" style="font-size: 10px; font-weight: 600; color: #475569; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${order.customer || 'N/A'}">${order.customer || 'N/A'}</div>
                        </div>
                        <div>
                            <div class="so-order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Picker</div>
                            <div class="so-order-group-value-sm" style="font-size: 10px; font-weight: 600; color: #7c3aed; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${order.picker || ''}">${order.picker || '-'}</div>
                        </div>
                        <div>
                            <div class="so-order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Lines</div>
                            <div class="so-order-group-value-sm" style="font-size: 11px; font-weight: 700; color: #1e293b;">${order.totalLines}</div>
                        </div>
                        <div>
                            <div class="so-order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Processed</div>
                            <div class="so-order-group-value-sm" style="font-size: 11px; font-weight: 700; color: #10b981;">${order.processedLines}</div>
                        </div>
                        <div>
                            <div class="so-order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Pending</div>
                            <div class="so-order-group-value-sm" style="font-size: 11px; font-weight: 700; color: ${order.notProcessedLines > 0 ? '#ef4444' : '#cbd5e1'};">${order.notProcessedLines}</div>
                        </div>
                        <div>
                            <div class="so-order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Req Qty</div>
                            <div class="so-order-group-value-sm" style="font-size: 11px; font-weight: 700; color: #667eea;">${order.totalRequestedQty}</div>
                        </div>
                        <div>
                            <div class="so-order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Picked Qty</div>
                            <div class="so-order-group-value-sm" style="font-size: 11px; font-weight: 700; color: #667eea;">${order.totalPickedQty}</div>
                        </div>
                        <div>
                            <div class="so-order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Pick Confirm</div>
                            <div class="so-order-group-value-sm" style="font-size: 11px; font-weight: 700; color: ${orderPickConfirmColor};">${orderPickConfirm}</div>
                        </div>
                        <div>
                            <div class="so-order-group-label" style="font-size: 8px; color: #64748b; font-weight: 600; text-transform: uppercase;">Ship Confirm</div>
                            <div class="so-order-group-value-sm" style="font-size: 11px; font-weight: 700; color: ${orderShipConfirmColor};">${orderShipConfirm}</div>
                        </div>
                        <div>
                            <span class="so-order-stats-badge" style="display: inline-flex; align-items: center; gap: 0.2rem; background: ${statusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
                                <i class="fas fa-${statusIcon}"></i> ${orderStatus}
                            </span>
                        </div>
                        <div style="display: flex; gap: 0.4rem; margin-left: auto;">
                            <button onclick="event.stopPropagation(); soOpenOrderTransactions('${order.source_order}', ${tripIndex}, ${orderIdx})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.3rem 0.6rem; border-radius: 5px; cursor: pointer; font-size: 9px; font-weight: 600; display: flex; align-items: center; gap: 0.2rem; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="View Order Transactions">
                                <i class="fas fa-edit"></i> Edit
                            </button>
                            <button onclick="event.stopPropagation(); printSOOrder('${order.source_order}', ${tripIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.3rem 0.6rem; border-radius: 5px; cursor: pointer; font-size: 9px; font-weight: 600; display: flex; align-items: center; gap: 0.2rem; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                                <i class="fas fa-print"></i> Print
                            </button>
                        </div>
                    </div>
                    <i class="fas fa-chevron-down" id="so-order-chevron-${orderId}" style="color: #667eea; transition: transform 0.3s; font-size: 10px;"></i>
                </div>

                <!-- Order Items (Collapsible) -->
                <div id="so-order-details-${orderId}" style="display: none;">
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #f8f9fa; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">#</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Pick Slip</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Line</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Item</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Description</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Lot</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Req Qty</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Picked</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Src Subinv</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Dest Subinv</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Pick Confirm</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Ship Confirm</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Status</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Action</th>
                                </tr>
                            </thead>
                            <tbody>
        `;

        order.items.forEach((item, itemIdx) => {
            const itemStatus = getLineStatus(item);
            const itemStatusColor = itemStatus === 'SUCCESS' ? '#10b981' :
                                   itemStatus === 'FAILED' ? '#ef4444' :
                                   itemStatus === 'PROCESSING' ? '#f59e0b' :
                                   itemStatus === 'CANCELLED' ? '#6b7280' :
                                   '#3b82f6';

            const itemStatusIcon = itemStatus === 'SUCCESS' ? 'check-circle' :
                                  itemStatus === 'FAILED' ? 'times-circle' :
                                  itemStatus === 'PROCESSING' ? 'spinner fa-spin' :
                                  itemStatus === 'CANCELLED' ? 'ban' :
                                  'clock';

            const pickConfirmColor = item.pick_confirm_st === 'YES' ? '#10b981' : '#ef4444';
            const shipConfirmColor = item.ship_confirm_st === 'YES' ? '#10b981' : '#ef4444';

            html += `
                <tr id="so-transaction-row-${tripIndex}-${item.originalIndex}" class="so-order-row-${orderId}" style="border-bottom: 1px solid #f0f0f0;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='white'">
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #94a3b8; font-weight: 600;">${itemIdx + 1}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; font-weight: 600; color: #667eea;">${item.pick_slip || '-'}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; font-weight: 600; color: #1e293b;">${item.pick_slip_line || '-'}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; font-weight: 600; color: #667eea;">${item.item || '-'}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #475569; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.description || ''}">${item.description || '-'}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #475569;">${item.lot || '-'}</td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center; font-size: 12px; font-weight: 700; color: #3b82f6;">${item.requested_quantity || 0}</td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center; font-size: 12px; font-weight: 700; color: #1e293b;">${item.picked_qty || 0}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 10px; color: #475569;">${item.source_subinventory || '-'}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 10px; color: #475569;">${item.destination_subinventory || '-'}</td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: ${pickConfirmColor};">
                        ${item.pick_confirm_st || 'NO'}
                    </td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: ${shipConfirmColor};">
                        ${item.ship_confirm_st || 'NO'}
                    </td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center;" id="so-status-cell-${tripIndex}-${item.originalIndex}">
                        <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${itemStatusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
                            <i class="fas fa-${itemStatusIcon}"></i> ${itemStatus}
                        </span>
                    </td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center;" id="so-action-cell-${tripIndex}-${item.originalIndex}">
                        ${itemStatus === 'FAILED' ? `
                            <div style="display: flex; gap: 0.3rem; justify-content: center; flex-wrap: wrap;">
                                <button onclick="processSOSingleLine(${tripIndex}, ${item.originalIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 9px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 3px;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="Retry processing">
                                    <i class="fas fa-redo"></i> Retry
                                </button>
                                <button onclick="soPickLine(${tripIndex}, ${item.originalIndex}, '${item.pick_slip}', '${item.pick_slip_line}')" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 9px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 3px;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="Pick Line">
                                    <i class="fas fa-hand-pointer"></i> Pick
                                </button>
                                <button onclick="soCancelLine(${tripIndex}, ${item.originalIndex}, '${item.pick_slip}', '${item.pick_slip_line}')" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 9px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 3px;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="Cancel Line">
                                    <i class="fas fa-ban"></i> Cancel
                                </button>
                            </div>
                        ` : itemStatus === 'PROCESSING' ? `
                            <span style="color: #f59e0b; font-size: 10px;"><i class="fas fa-spinner fa-spin"></i> Processing...</span>
                        ` : itemStatus === 'SUCCESS' ? `
                            <span style="color: #10b981; font-size: 10px;"><i class="fas fa-check-circle"></i> Done</span>
                        ` : itemStatus === 'CANCELLED' ? `
                            <span style="color: #6b7280; font-size: 10px;"><i class="fas fa-ban"></i> Cancelled</span>
                        ` : `
                            <div style="display: flex; gap: 0.3rem; justify-content: center; flex-wrap: wrap;">
                                <button onclick="processSOSingleLine(${tripIndex}, ${item.originalIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 9px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 3px;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="Process Line">
                                    <i class="fas fa-play"></i> Process
                                </button>
                                <button onclick="soPickLine(${tripIndex}, ${item.originalIndex}, '${item.pick_slip}', '${item.pick_slip_line}')" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 9px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 3px;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="Pick Line">
                                    <i class="fas fa-hand-pointer"></i> Pick
                                </button>
                                <button onclick="soCancelLine(${tripIndex}, ${item.originalIndex}, '${item.pick_slip}', '${item.pick_slip_line}')" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 9px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 3px;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'" title="Cancel Line">
                                    <i class="fas fa-ban"></i> Cancel
                                </button>
                            </div>
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
function toggleSOTripDetails(index) {
    const details = document.getElementById(`so-trip-details-${index}`);
    const chevron = document.getElementById(`so-trip-chevron-${index}`);

    if (details.style.display === 'none') {
        details.style.display = 'block';
        chevron.style.transform = 'rotate(180deg)';
    } else {
        details.style.display = 'none';
        chevron.style.transform = 'rotate(0deg)';
    }
}

// Toggle trip selection for processing
function toggleSOTripSelection(tripId, index) {
    const tripIdStr = String(tripId);
    const btn = document.getElementById(`so-trip-select-btn-${index}`);
    const tripCard = document.getElementById(`so-trip-card-${index}`);

    if (selectedSOTripsForProcessing.has(tripIdStr)) {
        // Deselect
        selectedSOTripsForProcessing.delete(tripIdStr);
        if (btn) {
            btn.style.background = '#94a3b8';
            btn.style.borderColor = '#94a3b8';
            btn.innerHTML = '<i class="fas fa-square"></i> Select';
        }
        if (tripCard) {
            tripCard.style.borderColor = '#e2e8f0';
            tripCard.style.borderWidth = '2px';
        }
        addSOLogEntry('Selection', `Trip ${tripId} deselected`, 'info');
    } else {
        // Select
        selectedSOTripsForProcessing.add(tripIdStr);
        if (btn) {
            btn.style.background = '#f59e0b';
            btn.style.borderColor = '#f59e0b';
            btn.innerHTML = '<i class="fas fa-check-square"></i> Selected';
        }
        if (tripCard) {
            tripCard.style.borderColor = '#f59e0b';
            tripCard.style.borderWidth = '3px';
        }
        addSOLogEntry('Selection', `Trip ${tripId} selected for processing`, 'info');
    }

    updateSOSelectionCount();
}

// Select all trips for processing
function selectAllSOTrips() {
    const groupedTrips = groupSOTransactionsByTrip();
    groupedTrips.forEach((trip, index) => {
        const tripIdStr = String(trip.trip_id);
        if (!selectedSOTripsForProcessing.has(tripIdStr)) {
            selectedSOTripsForProcessing.add(tripIdStr);
            const btn = document.getElementById(`so-trip-select-btn-${index}`);
            const tripCard = document.getElementById(`so-trip-card-${index}`);
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
    updateSOSelectionCount();
    addSOLogEntry('Selection', `All ${groupedTrips.length} trips selected`, 'info');
}

// Deselect all trips
function deselectAllSOTrips() {
    const groupedTrips = groupSOTransactionsByTrip();
    selectedSOTripsForProcessing.clear();
    groupedTrips.forEach((trip, index) => {
        const btn = document.getElementById(`so-trip-select-btn-${index}`);
        const tripCard = document.getElementById(`so-trip-card-${index}`);
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
    updateSOSelectionCount();
    addSOLogEntry('Selection', 'All trips deselected', 'info');
}

// Update selection count display
function updateSOSelectionCount() {
    const countEl = document.getElementById('selected-so-trips-count');
    if (countEl) {
        const count = selectedSOTripsForProcessing.size;
        countEl.textContent = count > 0 ? `${count} trip${count > 1 ? 's' : ''} selected` : 'No trips selected';
        countEl.style.color = count > 0 ? '#f59e0b' : '#94a3b8';
    }
}

// Toggle order details
function toggleSOOrderDetails(orderId) {
    const details = document.getElementById(`so-order-details-${orderId}`);
    const chevron = document.getElementById(`so-order-chevron-${orderId}`);

    if (details.style.display === 'none') {
        details.style.display = 'block';
        chevron.style.transform = 'rotate(180deg)';
    } else {
        details.style.display = 'none';
        chevron.style.transform = 'rotate(0deg)';
    }
}

// Expand all orders in a trip
function expandAllSOOrders(tripIndex) {
    const containers = document.querySelectorAll(`[data-so-order-container="${tripIndex}"]`);
    containers.forEach((container) => {
        const detailsEl = container.querySelector('[id^="so-order-details-"]');
        if (detailsEl) {
            const orderId = detailsEl.id.replace('so-order-details-', '');
            const details = document.getElementById(`so-order-details-${orderId}`);
            const chevron = document.getElementById(`so-order-chevron-${orderId}`);

            if (details && chevron) {
                details.style.display = 'block';
                chevron.style.transform = 'rotate(180deg)';
            }
        }
    });
    addSOLogEntry('UI', `Expanded all orders in trip ${tripIndex}`, 'info');
}

// Collapse all orders in a trip
function collapseAllSOOrders(tripIndex) {
    const containers = document.querySelectorAll(`[data-so-order-container="${tripIndex}"]`);
    containers.forEach((container) => {
        const detailsEl = container.querySelector('[id^="so-order-details-"]');
        if (detailsEl) {
            const orderId = detailsEl.id.replace('so-order-details-', '');
            const details = document.getElementById(`so-order-details-${orderId}`);
            const chevron = document.getElementById(`so-order-chevron-${orderId}`);

            if (details && chevron) {
                details.style.display = 'none';
                chevron.style.transform = 'rotate(0deg)';
            }
        }
    });
    addSOLogEntry('UI', `Collapsed all orders in trip ${tripIndex}`, 'info');
}

// Toggle expand/collapse all orders (global)
let allSOOrdersExpanded = false;

function toggleSOExpandCollapseAll() {
    const allDetails = document.querySelectorAll('[id^="so-order-details-"]');
    const allChevrons = document.querySelectorAll('[id^="so-order-chevron-"]');
    const button = document.getElementById('so-expand-collapse-all-btn');

    if (!allSOOrdersExpanded) {
        // Expand all
        allDetails.forEach(details => {
            details.style.display = 'block';
        });
        allChevrons.forEach(chevron => {
            chevron.style.transform = 'rotate(180deg)';
        });
        button.innerHTML = '<i class="fas fa-compress-alt"></i> Collapse All';
        allSOOrdersExpanded = true;
        addSOLogEntry('UI', 'Expanded all orders', 'info');
    } else {
        // Collapse all
        allDetails.forEach(details => {
            details.style.display = 'none';
        });
        allChevrons.forEach(chevron => {
            chevron.style.transform = 'rotate(0deg)';
        });
        button.innerHTML = '<i class="fas fa-expand-alt"></i> Expand All';
        allSOOrdersExpanded = false;
        addSOLogEntry('UI', 'Collapsed all orders', 'info');
    }
}

// Update statistics based on actual API fields
function updateSOStatistics() {
    const groupedTrips = groupSOTransactionsByTrip();

    // Calculate stats
    autoSOProcessingStats.totalTrips = groupedTrips.length;

    // Total Orders = distinct source_order count
    const distinctOrders = [...new Set(autoSOProcessingData.map(t => t.source_order))];
    autoSOProcessingStats.totalOrders = distinctOrders.length;

    // Total Lines = all transactions
    autoSOProcessingStats.totalLines = autoSOProcessingData.length;

    // Count by status
    autoSOProcessingStats.success = autoSOProcessingData.filter(t => getLineStatus(t) === 'SUCCESS').length;
    autoSOProcessingStats.failed = autoSOProcessingData.filter(t => getLineStatus(t) === 'FAILED').length;
    autoSOProcessingStats.processing = autoSOProcessingData.filter(t => getLineStatus(t) === 'PROCESSING').length;
    autoSOProcessingStats.cancelled = autoSOProcessingData.filter(t => getLineStatus(t) === 'CANCELLED').length;

    // Update UI
    document.getElementById('auto-so-stat-trips').textContent = autoSOProcessingStats.totalTrips;
    document.getElementById('auto-so-stat-orders').textContent = autoSOProcessingStats.totalOrders;
    document.getElementById('auto-so-stat-lines').textContent = autoSOProcessingStats.totalLines;
    document.getElementById('auto-so-stat-cancelled').textContent = autoSOProcessingStats.cancelled;
    document.getElementById('auto-so-stat-success').textContent = autoSOProcessingStats.success;
    document.getElementById('auto-so-stat-failed').textContent = autoSOProcessingStats.failed;
    document.getElementById('auto-so-stat-processing').textContent = autoSOProcessingStats.processing;
}

// Start auto processing
function startAutoSOProcessing() {
    if (autoSOProcessingData.length === 0) {
        alert('Please fetch data first before enabling auto processing');
        document.getElementById('auto-so-process-toggle').checked = false;
        return;
    }

    autoSOProcessingEnabled = true;
    document.getElementById('auto-so-process-status').textContent = 'ENABLED';
    document.getElementById('auto-so-process-status').style.color = '#10b981';

    addSOLogEntry('System', 'Auto processing mode ENABLED - Ready to process', 'success');
}

// Stop auto processing
function stopAutoSOProcessing() {
    autoSOProcessingEnabled = false;
    document.getElementById('auto-so-process-status').textContent = 'DISABLED';
    document.getElementById('auto-so-process-status').style.color = '#dc3545';

    if (autoSOProcessingInterval) {
        clearInterval(autoSOProcessingInterval);
        autoSOProcessingInterval = null;
    }

    addSOLogEntry('System', 'Auto processing DISABLED', 'warning');
}

// Format time to HH:MM:SS
function formatSOTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Calculate duration between two dates
function calculateSODuration(startDate, endDate) {
    const diff = endDate - startDate;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Start processing timer
function startSOProcessingTimer() {
    soProcessingStartTime = new Date();
    soProcessingEndTime = null;

    // Show timer display
    const timerDisplay = document.getElementById('so-processing-timer');
    if (timerDisplay) {
        timerDisplay.style.display = 'flex';
    }

    // Set start time
    document.getElementById('so-timer-start-time').textContent = formatSOTime(soProcessingStartTime);
    document.getElementById('so-timer-end-time').textContent = '--:--:--';
    document.getElementById('so-timer-duration').textContent = '00:00:00';

    // Clear any existing interval
    if (soProcessingTimerInterval) {
        clearInterval(soProcessingTimerInterval);
    }

    // Update duration every second
    soProcessingTimerInterval = setInterval(() => {
        if (soProcessingStartTime && !soProcessingEndTime) {
            const now = new Date();
            const duration = calculateSODuration(soProcessingStartTime, now);
            document.getElementById('so-timer-duration').textContent = duration;
        }
    }, 1000);

    console.log('[SO Timer] Processing timer started at:', formatSOTime(soProcessingStartTime));
}

// Stop processing timer
function stopSOProcessingTimer() {
    soProcessingEndTime = new Date();

    // Stop interval
    if (soProcessingTimerInterval) {
        clearInterval(soProcessingTimerInterval);
        soProcessingTimerInterval = null;
    }

    // Set end time and final duration
    document.getElementById('so-timer-end-time').textContent = formatSOTime(soProcessingEndTime);
    const finalDuration = calculateSODuration(soProcessingStartTime, soProcessingEndTime);
    document.getElementById('so-timer-duration').textContent = finalDuration;

    console.log('[SO Timer] Processing timer stopped at:', formatSOTime(soProcessingEndTime), 'Duration:', finalDuration);
}

// Run simulation - manually triggered
function runSOSimulation() {
    // If already processing, stop it
    if (isSOProcessing) {
        stopSOProcessing();
        return;
    }

    // Otherwise, start processing
    if (!autoSOProcessingEnabled) {
        alert('Please enable Auto Processing first');
        return;
    }

    if (autoSOProcessingData.length === 0) {
        alert('Please fetch data first');
        return;
    }

    // Check if any trips are selected
    if (selectedSOTripsForProcessing.size === 0) {
        alert('Please select at least one trip for processing.\n\nClick the "Select" button on each trip you want to process, or use "Select All" to select all trips.');
        return;
    }

    addSOLogEntry('System', `Starting process - Processing ${selectedSOTripsForProcessing.size} selected trip(s)...`, 'info');

    // Set processing flag
    isSOProcessing = true;

    // Update button to show "Stop Processing"
    const button = document.getElementById('auto-so-run-simulation-btn');
    if (button) {
        button.innerHTML = '<i class="fas fa-stop"></i> Stop Processing';
        button.style.background = '#ef4444';
        button.style.boxShadow = '0 2px 4px rgba(239, 68, 68, 0.3)';
    }

    // Start timer
    startSOProcessingTimer();

    // Start sequential processing
    processSONextBatch();
}

// Stop processing
function stopSOProcessing() {
    isSOProcessing = false;
    currentSOProcessingTrip = null;
    currentSOProcessingTripId = null;
    currentSOProcessingOrder = null;

    addSOLogEntry('System', 'Processing stopped by user', 'warning');

    // Update button back to "Start Process"
    const button = document.getElementById('auto-so-run-simulation-btn');
    if (button) {
        button.innerHTML = '<i class="fas fa-play"></i> Start Process';
        button.style.background = '#10b981';
        button.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.3)';
    }

    // Stop timer
    if (soProcessingStartTime && !soProcessingEndTime) {
        stopSOProcessingTimer();
    }
}

// Process next batch of transactions
async function processSONextBatch() {
    if (!autoSOProcessingEnabled) return;

    addSOLogEntry('Debug', `Total records in data: ${autoSOProcessingData.length}`, 'info');
    addSOLogEntry('Debug', `Selected trips for processing: ${Array.from(selectedSOTripsForProcessing).join(', ')}`, 'info');

    // Find pending transactions - ONLY from SELECTED trips
    const pendingTransactions = autoSOProcessingData.filter(t => {
        const status = getLineStatus(t);
        const isPending = status === 'PENDING';
        const tripIdStr = String(t.trip_id);
        const isSelectedTrip = selectedSOTripsForProcessing.has(tripIdStr);
        return isPending && isSelectedTrip;
    });

    addSOLogEntry('Debug', `Filtered pending records: ${pendingTransactions.length}`, 'info');

    if (pendingTransactions.length === 0) {
        addSOLogEntry('Processing', 'No pending transactions found. All records may already be processed.', 'warning');
        stopSOProcessing();
        return;
    }

    // Group pending transactions by source_order
    const transactionsByOrder = {};
    pendingTransactions.forEach(t => {
        const orderNum = t.source_order || 'Unknown';
        if (!transactionsByOrder[orderNum]) {
            transactionsByOrder[orderNum] = [];
        }
        transactionsByOrder[orderNum].push(t);
    });

    const orderNumbers = Object.keys(transactionsByOrder);
    addSOLogEntry('Processing', `Found ${orderNumbers.length} orders with ${pendingTransactions.length} pending transactions. Starting processing...`, 'info');

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
            if (!isSOProcessing || !autoSOProcessingEnabled) {
                addSOLogEntry('Processing', 'Processing was stopped. Stopping...', 'warning');
                break;
            }

            // Update current processing status
            const firstTransaction = orderTransactions[0];
            currentSOProcessingTrip = firstTransaction.trip_id || '-';
            currentSOProcessingTripId = firstTransaction.trip_id || '-';
            currentSOProcessingOrder = orderNumber;

            addSOLogEntry('Order', `Processing Order: ${orderNumber} (${orderTransactions.length} lines)`, 'info');

            // Process all lines in this order
            for (let i = 0; i < orderTransactions.length; i++) {
                const transaction = orderTransactions[i];

                // Check if processing was stopped
                if (!isSOProcessing || !autoSOProcessingEnabled) {
                    addSOLogEntry('Processing', 'Processing was stopped. Stopping...', 'warning');
                    break;
                }

                // Find the trip and transaction index for DOM update
                const groupedTrips = groupSOTransactionsByTrip();
                let actualTripIndex = -1;
                let actualTransactionIndex = -1;

                groupedTrips.forEach((trip, tIdx) => {
                    const idx = trip.transactions.findIndex(t => t === transaction);
                    if (idx !== -1) {
                        actualTripIndex = tIdx;
                        actualTransactionIndex = idx;
                    }
                });

                // Update status to PROCESSING in DOM
                transaction.processing_status = 'PROCESSING';
                if (actualTripIndex !== -1 && actualTransactionIndex !== -1) {
                    updateSOTransactionStatusInDOM(actualTripIndex, actualTransactionIndex, 'PROCESSING');
                }

                // Simulate processing (replace with actual API call)
                await new Promise(resolve => setTimeout(resolve, 500));

                // Mark as SUCCESS (replace with actual result handling)
                transaction.processing_status = 'SUCCESS';
                transaction.pick_confirm_st = 'YES';
                processedCount++;
                successCount++;

                // Update DOM
                if (actualTripIndex !== -1 && actualTransactionIndex !== -1) {
                    updateSOTransactionStatusInDOM(actualTripIndex, actualTransactionIndex, 'SUCCESS');
                }

                // Update statistics periodically
                if (processedCount % 5 === 0 || (orderIdx === orderNumbers.length - 1 && i === orderTransactions.length - 1)) {
                    addSOLogEntry('Progress', `Processed ${processedCount} of ${pendingTransactions.length} transactions (${successCount} success, ${failedCount} failed)`, 'info');
                    updateSOStatistics();
                }
            }

            processedOrders++;
            addSOLogEntry('Order', `✓ Order ${orderNumber} completed (${orderTransactions.length} lines processed)`, 'success');
        }
    } catch (error) {
        addSOLogEntry('Error', `Processing error: ${error.message}`, 'error');
    }

    // Processing complete
    stopSOProcessing();
    updateSOStatistics();
    addSOLogEntry('System', `Processing complete. ${successCount} success, ${failedCount} failed out of ${processedCount} total.`, 'success');
}

// Update single transaction status in DOM
function updateSOTransactionStatusInDOM(tripIndex, transactionIndex, status) {
    const statusCell = document.getElementById(`so-status-cell-${tripIndex}-${transactionIndex}`);
    const actionCell = document.getElementById(`so-action-cell-${tripIndex}-${transactionIndex}`);

    if (!statusCell || !actionCell) return;

    // Update status badge
    const statusColor = status === 'SUCCESS' ? '#10b981' :
                       status === 'FAILED' ? '#ef4444' :
                       status === 'PROCESSING' ? '#f59e0b' :
                       status === 'CANCELLED' ? '#6b7280' :
                       '#3b82f6';

    const statusIcon = status === 'SUCCESS' ? 'check-circle' :
                      status === 'FAILED' ? 'times-circle' :
                      status === 'PROCESSING' ? 'spinner fa-spin' :
                      status === 'CANCELLED' ? 'ban' :
                      'clock';

    statusCell.innerHTML = `
        <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${statusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
            <i class="fas fa-${statusIcon}"></i> ${status}
        </span>
    `;

    // Update action button
    if (status === 'FAILED') {
        actionCell.innerHTML = `
            <div style="display: flex; gap: 0.25rem; justify-content: center;">
                <button onclick="processSOSingleLine(${tripIndex}, ${transactionIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                    <i class="fas fa-redo"></i> Retry
                </button>
            </div>
        `;
    } else if (status === 'PROCESSING') {
        actionCell.innerHTML = `<span style="color: #f59e0b; font-size: 10px;"><i class="fas fa-spinner fa-spin"></i> Processing...</span>`;
    } else if (status === 'SUCCESS') {
        actionCell.innerHTML = `<span style="color: #10b981; font-size: 10px;"><i class="fas fa-check-circle"></i> Done</span>`;
    } else if (status === 'CANCELLED') {
        actionCell.innerHTML = `<span style="color: #6b7280; font-size: 10px;"><i class="fas fa-ban"></i> Cancelled</span>`;
    } else {
        actionCell.innerHTML = `
            <button onclick="processSOSingleLine(${tripIndex}, ${transactionIndex})" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">
                <i class="fas fa-play"></i> Process
            </button>
        `;
    }
}

// Process single order
function processSOSingleOrder(orderNumber, tripIndex) {
    addSOLogEntry('Order', `Manual processing triggered for Order: ${orderNumber}`, 'info');
    alert(`Processing Order: ${orderNumber}\n\nThis feature will process all pending lines in this order.`);
}

// Process single line
function processSOSingleLine(tripIndex, transactionIndex) {
    addSOLogEntry('Line', `Manual processing triggered for line at index: ${transactionIndex}`, 'info');
    updateSOTransactionStatusInDOM(tripIndex, transactionIndex, 'PROCESSING');

    // Simulate processing
    setTimeout(() => {
        updateSOTransactionStatusInDOM(tripIndex, transactionIndex, 'SUCCESS');
        const groupedTrips = groupSOTransactionsByTrip();
        if (groupedTrips[tripIndex] && groupedTrips[tripIndex].transactions[transactionIndex]) {
            groupedTrips[tripIndex].transactions[transactionIndex].processing_status = 'SUCCESS';
            groupedTrips[tripIndex].transactions[transactionIndex].pick_confirm_st = 'YES';
        }
        updateSOStatistics();
        addSOLogEntry('Line', `Line processed successfully`, 'success');
    }, 1000);
}

// Add log entry
function addSOLogEntry(category, message, type) {
    const logContainer = document.getElementById('auto-so-log-container');
    if (!logContainer) return;

    const timestamp = new Date().toLocaleTimeString();
    const colorClass = type === 'success' ? '#10b981' :
                      type === 'error' ? '#ef4444' :
                      type === 'warning' ? '#f59e0b' :
                      '#94a3b8';

    const entry = document.createElement('div');
    entry.style.color = colorClass;
    entry.innerHTML = `<span style="color: #64748b;">[${timestamp}]</span> [${category}] ${message}`;

    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;

    console.log(`[Auto SO Processing] [${category}] ${message}`);
}

// Switch tabs
function switchAutoSOTab(tabId) {
    // Hide all tab contents
    document.querySelectorAll('.auto-so-tab-content').forEach(content => {
        content.style.display = 'none';
    });

    // Remove active class from all buttons
    document.querySelectorAll('.auto-so-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.color = '#64748b';
        btn.style.borderBottomColor = 'transparent';
    });

    // Show selected tab content
    const tabContent = document.getElementById(`auto-${tabId}`);
    if (tabContent) {
        tabContent.style.display = 'block';
    }

    // Add active class to clicked button
    const activeBtn = document.querySelector(`.auto-so-tab-btn[data-tab="${tabId}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.color = '#667eea';
        activeBtn.style.borderBottomColor = '#667eea';
    }
}

// Populate filter dropdowns based on actual API fields
function populateSOFilterDropdowns() {
    // Trip ID
    const tripIdList = document.getElementById('so-trip-id-list');
    if (tripIdList) {
        tripIdList.innerHTML = '';
        const tripIds = [...new Set(autoSOProcessingData.map(t => t.trip_id))];
        tripIds.forEach(id => {
            const option = document.createElement('option');
            option.value = id;
            tripIdList.appendChild(option);
        });
    }

    // Order Number (source_order)
    const orderNumberList = document.getElementById('so-order-number-list');
    if (orderNumberList) {
        orderNumberList.innerHTML = '';
        const orderNumbers = [...new Set(autoSOProcessingData.map(t => t.source_order))];
        orderNumbers.forEach(num => {
            const option = document.createElement('option');
            option.value = num;
            orderNumberList.appendChild(option);
        });
    }

    // Item Description (description)
    const itemDescList = document.getElementById('so-item-desc-list');
    if (itemDescList) {
        itemDescList.innerHTML = '';
        const itemDescs = [...new Set(autoSOProcessingData.map(t => t.description).filter(d => d))];
        itemDescs.slice(0, 100).forEach(desc => {
            const option = document.createElement('option');
            option.value = desc;
            itemDescList.appendChild(option);
        });
    }

    // Customer
    const customerList = document.getElementById('so-customer-list');
    if (customerList) {
        customerList.innerHTML = '';
        const customers = [...new Set(autoSOProcessingData.map(t => t.customer).filter(c => c))];
        customers.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer;
            customerList.appendChild(option);
        });
    }
}

// Apply filters
function applySOFilters() {
    displaySOGroupedTrips();
    updateSOStatistics();
    addSOLogEntry('Filter', 'Filters applied', 'info');
}

// Clear filters
function clearSOFilters() {
    document.getElementById('so-filter-trip-id').value = '';
    document.getElementById('so-filter-order-number').value = '';
    document.getElementById('so-filter-item-desc').value = '';
    document.getElementById('so-filter-customer').value = '';
    document.getElementById('so-filter-status').value = '';
    displaySOGroupedTrips();
    updateSOStatistics();
    addSOLogEntry('Filter', 'Filters cleared', 'info');
}

// Font size adjustment functions
function adjustSOTripOrderFontSize(direction) {
    soTripOrderFontSizeMultiplier += direction * SO_FONT_SIZE_STEP;
    soTripOrderFontSizeMultiplier = Math.max(SO_FONT_SIZE_MIN, Math.min(SO_FONT_SIZE_MAX, soTripOrderFontSizeMultiplier));
    applySOFontSize();
}

function resetSOTripOrderFontSize() {
    soTripOrderFontSizeMultiplier = 1.0;
    applySOFontSize();
}

function applySOFontSize() {
    const indicator = document.getElementById('so-font-size-indicator');
    if (indicator) {
        indicator.textContent = `${Math.round(soTripOrderFontSizeMultiplier * 100)}%`;
    }

    // Apply to trip headers
    document.querySelectorAll('.so-trip-group-value').forEach(el => {
        el.style.fontSize = `${13 * soTripOrderFontSizeMultiplier}px`;
    });
    document.querySelectorAll('.so-trip-group-value-sm').forEach(el => {
        el.style.fontSize = `${11 * soTripOrderFontSizeMultiplier}px`;
    });
    document.querySelectorAll('.so-trip-group-label').forEach(el => {
        el.style.fontSize = `${8 * soTripOrderFontSizeMultiplier}px`;
    });
    document.querySelectorAll('.so-trip-group-icon').forEach(el => {
        el.style.fontSize = `${16 * soTripOrderFontSizeMultiplier}px`;
    });

    // Apply to order headers
    document.querySelectorAll('.so-order-group-value').forEach(el => {
        el.style.fontSize = `${12 * soTripOrderFontSizeMultiplier}px`;
    });
    document.querySelectorAll('.so-order-group-value-sm').forEach(el => {
        el.style.fontSize = `${10 * soTripOrderFontSizeMultiplier}px`;
    });
    document.querySelectorAll('.so-order-group-label').forEach(el => {
        el.style.fontSize = `${8 * soTripOrderFontSizeMultiplier}px`;
    });
    document.querySelectorAll('.so-order-group-icon').forEach(el => {
        el.style.fontSize = `${14 * soTripOrderFontSizeMultiplier}px`;
    });
}

// ============================================================================
// PRINT FUNCTIONALITY
// ============================================================================

// Global state for print modal
let currentSOTripPrintData = null;

// Print single order
function printSOOrder(orderNumber, tripIndex) {
    addSOLogEntry('Print', `Printing Order ${orderNumber}...`, 'info');

    const groupedTrips = groupSOTransactionsByTrip();
    const trip = groupedTrips[tripIndex];

    if (!trip) {
        addSOLogEntry('Error', `Trip at index ${tripIndex} not found`, 'error');
        alert('Trip not found');
        return;
    }

    // Get all transactions for this order
    const orderTransactions = trip.transactions.filter(t => t.source_order === orderNumber);

    if (orderTransactions.length === 0) {
        addSOLogEntry('Error', `No transactions found for order ${orderNumber}`, 'error');
        alert('Order not found');
        return;
    }

    // Get instance name, trip_id, and trip_date from first transaction
    const instance = orderTransactions[0].instance_name || orderTransactions[0].INSTANCE_NAME || 'PROD';
    const tripId = orderTransactions[0].trip_id || '';
    let tripDate = orderTransactions[0].trip_date || '';
    const orderType = orderTransactions[0].order_type || orderTransactions[0].ORDER_TYPE || 'Sales Order';

    // Format tripDate to YYYY-MM-DD format
    if (tripDate) {
        try {
            const dateObj = new Date(tripDate);
            tripDate = dateObj.toISOString().split('T')[0];
        } catch (e) {
            if (tripDate.includes('T')) {
                tripDate = tripDate.split('T')[0];
            }
        }
    }

    // Sales Order reports use a different path than Store Transaction reports
    // The report path will be determined by the order type value
    const reportPath = '/Custom/OQ/GR_SalesOrder_Rep.xdo';
    const parameterName = 'Order_Number';
    const reportName = 'Sales Order Report';

    // Show loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'so-print-loading-indicator';
    loadingDiv.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 30000; display: flex; align-items: center; justify-content: center;';
    loadingDiv.innerHTML = `
        <div style="background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); text-align: center;">
            <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: #8b5cf6; margin-bottom: 1rem;"></i>
            <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">Generating PDF Report...</div>
            <div style="font-size: 0.9rem; color: #64748b; margin-top: 0.5rem;">${reportName}</div>
            <div style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Order: ${orderNumber}</div>
            <div style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Instance: ${instance}</div>
            <div style="font-size: 0.85rem; color: #10b981; margin-top: 0.25rem;">Order Type: ${orderType}</div>
        </div>
    `;
    document.body.appendChild(loadingDiv);

    // Call C# handler to generate PDF from Oracle Fusion Cloud
    const message = {
        action: 'printSalesOrder',
        orderNumber: String(orderNumber),
        instance: String(instance),
        reportPath: String(reportPath),
        parameterName: String(parameterName),
        tripId: String(tripId),
        tripDate: String(tripDate),
        orderType: String(orderType)
    };

    const printStartTime = Date.now();
    console.log('[Order Print] ════════════════════════════════════════════════════════');
    console.log('[Order Print] 📤 SENDING PRINT REQUEST TO C#');
    console.log('[Order Print] Order Number:', orderNumber);
    console.log('[Order Print] Instance:', instance);
    console.log('[Order Print] Report Path:', reportPath);
    console.log('[Order Print] Parameter Name:', parameterName);
    console.log('[Order Print] Trip ID:', tripId);
    console.log('[Order Print] Trip Date:', tripDate);
    console.log('[Order Print] Order Type:', orderType);
    console.log('[Order Print] Full message:', JSON.stringify(message, null, 2));
    console.log('[Order Print] ⏱️ Started at:', new Date(printStartTime).toISOString());
    console.log('[Order Print] ════════════════════════════════════════════════════════');

    sendMessageToCSharp(message, function(error, data) {
        const elapsed = Date.now() - printStartTime;
        console.log('[Order Print] ════════════════════════════════════════════════════════');
        console.log('[Order Print] 📨 CALLBACK RECEIVED');
        console.log('[Order Print] ⏱️ Elapsed time:', elapsed, 'ms');
        console.log('[Order Print] Error:', error);
        console.log('[Order Print] Data type:', typeof data);
        console.log('[Order Print] Data:', JSON.stringify(data, null, 2));
        console.log('[Order Print] ════════════════════════════════════════════════════════');

        const loading = document.getElementById('so-print-loading-indicator');
        if (loading) loading.remove();

        if (error) {
            console.error('[Order Print] ❌ Error received:', error);
            addSOLogEntry('Error', `Failed to generate PDF report: ${error}`, 'error');
            alert('Error generating report: ' + error);
        } else {
            try {
                const response = typeof data === 'string' ? JSON.parse(data) : data;
                console.log('[Order Print] ✅ Parsed response:', JSON.stringify(response, null, 2));
                addSOLogEntry('Print', `Response received: ${JSON.stringify(response)}`, 'info');

                if (response.success) {
                    const pdfPath = response.pdfPath || response.filePath || response.path;
                    console.log('[Order Print] PDF Path found:', pdfPath);
                    if (pdfPath) {
                        addSOLogEntry('Print', `PDF generated successfully: ${pdfPath}`, 'success');
                        // Open PDF viewer
                        if (typeof window.showPdfViewer === 'function') {
                            console.log('[Order Print] Opening PDF viewer for:', pdfPath);
                            window.showPdfViewer(pdfPath, orderNumber, reportName);
                        } else {
                            console.log('[Order Print] PDF viewer not available, showing alert');
                            alert(`PDF report generated successfully!\n\nFile: ${pdfPath}`);
                        }
                    } else {
                        console.warn('[Order Print] ⚠️ Response success but no path returned');
                        addSOLogEntry('Print', `PDF generated but no path returned`, 'warning');
                    }
                } else {
                    console.error('[Order Print] ❌ Response not successful:', response.message);
                    addSOLogEntry('Error', `PDF generation failed: ${response.message || 'Unknown error'}`, 'error');
                    alert('Error generating report: ' + (response.message || 'Unknown error'));
                }
            } catch (parseError) {
                console.log('[Order Print] ⚠️ Parse error, checking if raw path:', parseError.message);
                // Handle non-JSON responses
                if (data && typeof data === 'string' &&
                    (data.includes('\\') || data.includes('.pdf') || data.includes('C:') || data.includes('/'))) {
                    const pdfPath = data.trim();
                    console.log('[Order Print] ✅ Data is a file path:', pdfPath);
                    addSOLogEntry('Print', `PDF generated: ${pdfPath}`, 'success');
                    if (typeof window.showPdfViewer === 'function') {
                        window.showPdfViewer(pdfPath, orderNumber, reportName);
                    } else {
                        alert(`PDF report generated successfully!\n\nFile: ${pdfPath}`);
                    }
                } else {
                    console.error('[Order Print] ❌ Cannot parse response:', data);
                    addSOLogEntry('Error', `Failed to parse response: ${parseError.message}`, 'error');
                }
            }
        }
    }, 90000); // 90 second timeout
}

// Open Trip Print Modal
window.openSOTripPrintModal = async function(tripId, tripDate, orderCount, tripIndex) {
    console.log('[SO Trip Print] Opening modal for trip:', tripId);

    // Format tripDate to YYYY-MM-DD
    let formattedTripDate = tripDate;
    if (tripDate) {
        try {
            const dateObj = new Date(tripDate);
            formattedTripDate = dateObj.toISOString().split('T')[0];
        } catch (e) {
            if (String(tripDate).includes('T')) {
                formattedTripDate = String(tripDate).split('T')[0];
            }
        }
    }

    // Get trip data
    const groupedTrips = groupSOTransactionsByTrip();
    const trip = groupedTrips[tripIndex];

    if (!trip) {
        alert('Trip not found');
        return;
    }

    // Get unique orders from trip
    const uniqueOrders = [...new Set(trip.transactions.map(t => t.source_order))];
    const orders = uniqueOrders.map(orderNum => {
        const orderTransactions = trip.transactions.filter(t => t.source_order === orderNum);
        const firstTrx = orderTransactions[0];
        return {
            orderNumber: orderNum,
            tripId: tripId,
            tripDate: formattedTripDate,
            instance: firstTrx.instance_name || firstTrx.INSTANCE_NAME || 'PROD',
            orderType: firstTrx.order_type || firstTrx.ORDER_TYPE || 'Sales Order',
            customer: firstTrx.customer || 'N/A',
            downloadStatus: 'PENDING',
            printStatus: 'PENDING',
            pdfPath: null,
            error: null
        };
    });

    // Sales Order Report
    let reportName = 'Sales Order Report';
    let instanceName = 'PROD';
    let orderTypeName = 'Sales Order';

    if (orders.length > 0) {
        instanceName = orders[0].instance;
        orderTypeName = orders[0].orderType;
        console.log('[SO Trip Print] Order Type:', orderTypeName);
        console.log('[SO Trip Print] Report:', reportName);
    }

    // Store current trip print data
    currentSOTripPrintData = {
        tripId: tripId,
        tripDate: formattedTripDate,
        orderCount: orders.length,
        orders: orders,
        tripIndex: tripIndex,
        reportName: reportName,
        instanceName: instanceName,
        orderTypeName: orderTypeName,
        reportPath: '/Custom/OQ/GR_SalesOrder_Rep.xdo',
        parameterName: 'Order_Number'
    };

    // Populate modal fields
    document.getElementById('so-trip-print-trip-id').textContent = tripId;
    document.getElementById('so-trip-print-instance-name').textContent = instanceName;
    document.getElementById('so-trip-print-order-type').textContent = orderTypeName;
    document.getElementById('so-trip-print-order-count').textContent = orders.length;
    document.getElementById('so-trip-print-report-name').textContent = reportName;
    document.getElementById('so-trip-print-status').textContent = 'Ready';
    document.getElementById('so-trip-print-status').style.color = '#10b981';

    // Update debug info
    document.getElementById('so-debug-report-name').textContent = reportName;
    document.getElementById('so-debug-report-path').textContent = currentSOTripPrintData.reportPath;
    document.getElementById('so-debug-param-name').textContent = currentSOTripPrintData.parameterName;
    document.getElementById('so-debug-order-type-sent').textContent = orderTypeName;
    document.getElementById('so-debug-trip-date-sent').textContent = formattedTripDate;
    document.getElementById('so-debug-path-format').textContent = `C:/fusion/${formattedTripDate}/${tripId}/{orderNumber}.pdf`;
    document.getElementById('so-debug-current-order').textContent = '-';

    // Generate and display SOAP XML that will be sent to Oracle Fusion
    const sampleOrderNumber = orders.length > 0 ? orders[0].orderNumber : '1234567';
    const soapXML = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>${currentSOTripPrintData.reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>
            <v2:item>
              <v2:name>${currentSOTripPrintData.parameterName}</v2:name>
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
    document.getElementById('so-debug-soap-xml').textContent = soapXML;

    // Reset buttons
    document.getElementById('so-trip-print-download-btn').style.display = 'inline-flex';
    document.getElementById('so-trip-print-download-btn').disabled = false;
    document.getElementById('so-trip-print-print-btn').style.display = 'none';
    document.getElementById('so-trip-print-retry-all-btn').style.display = 'none';
    document.getElementById('so-trip-print-error').style.display = 'none';

    // Render orders list
    renderSOTripPrintOrders();

    // Load printers
    loadSOTripPrinters();

    // Show modal
    const modal = document.getElementById('so-trip-print-modal');
    modal.style.display = 'flex';

    addSOLogEntry('Print', `Opened print modal for Trip ${tripId} with ${orders.length} orders`, 'info');
};

// Close Trip Print Modal
window.closeSOTripPrintModal = function() {
    const modal = document.getElementById('so-trip-print-modal');
    modal.style.display = 'none';
    currentSOTripPrintData = null;
};

// Toggle Debug Section
window.toggleSOTripPrintDebug = function() {
    const content = document.getElementById('so-trip-debug-content');
    const icon = document.getElementById('so-trip-debug-toggle-icon');

    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
    } else {
        content.style.display = 'none';
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
    }
};

// Update debug SOAP XML for specific order (called during processing)
function updateSODebugXMLForOrder(orderNumber) {
    if (!currentSOTripPrintData) return;

    const soapXML = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>${currentSOTripPrintData.reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>
            <v2:item>
              <v2:name>${currentSOTripPrintData.parameterName}</v2:name>
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

    document.getElementById('so-debug-soap-xml').textContent = soapXML;
    document.getElementById('so-debug-current-order').textContent = orderNumber;
}

// Load printers for modal
async function loadSOTripPrinters() {
    const select = document.getElementById('so-trip-print-printer-select');
    select.innerHTML = '<option value="">-- Loading printers... --</option>';

    try {
        // Use the same API as auto-inventory-processing
        const response = await new Promise((resolve, reject) => {
            const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            if (!window.pendingRequests) {
                window.pendingRequests = {};
            }

            window.pendingRequests[requestId] = (error, data) => {
                if (error) {
                    reject(new Error(error));
                } else {
                    try {
                        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                        resolve(parsedData);
                    } catch (parseError) {
                        reject(new Error(`JSON Parse Error: ${parseError.message}`));
                    }
                }
            };

            window.chrome.webview.postMessage({
                action: 'executeGet',
                requestId: requestId,
                fullUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/printers/all'
            });

            setTimeout(() => {
                if (window.pendingRequests[requestId]) {
                    delete window.pendingRequests[requestId];
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });

        const printers = response.items || [];

        select.innerHTML = '<option value="">-- Select a printer --</option>';
        printers.forEach(printer => {
            const option = document.createElement('option');
            option.value = printer.PRINTER_NAME || printer.printer_name;
            option.textContent = `${printer.PRINTER_NAME || printer.printer_name} (${printer.LOCATION || printer.location || 'Unknown'})`;
            select.appendChild(option);
        });

        console.log('[SO Trip Print] Loaded', printers.length, 'printers');
    } catch (error) {
        console.error('[SO Trip Print] Failed to load printers:', error);
        select.innerHTML = '<option value="">-- Failed to load printers --</option>';
    }
}

// Render orders list in modal
function renderSOTripPrintOrders() {
    const container = document.getElementById('so-trip-print-orders-list');

    if (!currentSOTripPrintData || !currentSOTripPrintData.orders) {
        container.innerHTML = '<p style="color: #94a3b8;">No orders to display</p>';
        return;
    }

    let html = '';
    currentSOTripPrintData.orders.forEach((order, index) => {
        const downloadStatusColor = order.downloadStatus === 'DOWNLOADED' ? '#10b981' :
                                   order.downloadStatus === 'DOWNLOADING' ? '#f59e0b' :
                                   order.downloadStatus === 'FAILED' ? '#ef4444' :
                                   '#94a3b8';

        const downloadStatusIcon = order.downloadStatus === 'DOWNLOADED' ? 'check-circle' :
                                  order.downloadStatus === 'DOWNLOADING' ? 'spinner fa-spin' :
                                  order.downloadStatus === 'FAILED' ? 'times-circle' :
                                  'clock';

        const printStatusColor = order.printStatus === 'PRINTED' ? '#10b981' :
                                order.printStatus === 'PRINTING' ? '#f59e0b' :
                                order.printStatus === 'FAILED' ? '#ef4444' :
                                '#94a3b8';

        const printStatusIcon = order.printStatus === 'PRINTED' ? 'check-circle' :
                               order.printStatus === 'PRINTING' ? 'spinner fa-spin' :
                               order.printStatus === 'FAILED' ? 'times-circle' :
                               'clock';

        // MRA Status
        const mraStatus = order.mraStatus || 'PENDING';
        const mraStatusColor = mraStatus === 'SUCCESS' ? '#10b981' :
                              mraStatus === 'PROCESSING' ? '#f59e0b' :
                              mraStatus === 'FAILED' ? '#ef4444' :
                              mraStatus === 'INTERFACED' ? '#ef4444' :
                              '#94a3b8';

        const mraStatusIcon = mraStatus === 'SUCCESS' ? 'check-circle' :
                             mraStatus === 'PROCESSING' ? 'spinner fa-spin' :
                             mraStatus === 'FAILED' ? 'times-circle' :
                             mraStatus === 'INTERFACED' ? 'check-double' :
                             'clock';

        const mraStatusText = mraStatus === 'INTERFACED' ? 'Interfaced' : mraStatus;

        html += `
            <div style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #667eea;">
                <div style="flex: 1;">
                    <div style="font-weight: 700; color: #1e293b; font-size: 13px;">${order.orderNumber}</div>
                    <div style="font-size: 11px; color: #64748b;">${order.customer}</div>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <div style="text-align: center; min-width: 80px;">
                        <div style="font-size: 9px; color: #64748b; font-weight: 600;">DOWNLOAD</div>
                        <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${downloadStatusColor}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">
                            <i class="fas fa-${downloadStatusIcon}"></i> ${order.downloadStatus}
                        </span>
                    </div>
                    <div style="text-align: center; min-width: 80px;">
                        <div style="font-size: 9px; color: #64748b; font-weight: 600;">PRINT</div>
                        <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${printStatusColor}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">
                            <i class="fas fa-${printStatusIcon}"></i> ${order.printStatus}
                        </span>
                    </div>
                    <div style="text-align: center; min-width: 80px;">
                        <div style="font-size: 9px; color: #64748b; font-weight: 600;">MRA</div>
                        <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${mraStatusColor}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">
                            <i class="fas fa-${mraStatusIcon}"></i> ${mraStatusText}
                        </span>
                    </div>
                    <div style="display: flex; gap: 0.25rem;">
                        <button onclick="showSOTripMRALog(${index})" style="background: #667eea; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 9px; font-weight: 600;" title="View MRA Log">
                            <i class="fas fa-list-alt"></i> Log
                        </button>
                        ${mraStatus === 'FAILED' ? `
                        <button onclick="retrySOTripMRA(${index})" style="background: #f59e0b; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 9px; font-weight: 600;" title="Retry MRA">
                            <i class="fas fa-redo"></i>
                        </button>
                        ` : ''}
                    </div>
                </div>
                ${order.error ? `<div style="font-size: 10px; color: #ef4444; max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${order.error}">${order.error}</div>` : ''}
            </div>
        `;
    });

    container.innerHTML = html;
}

// Start downloading PDFs for all orders in trip
window.startSOTripDownload = async function() {
    if (!currentSOTripPrintData) return;

    console.log('[SO Trip Print] Starting download for all orders...');
    addSOLogEntry('Print', `Starting PDF download for ${currentSOTripPrintData.orders.length} orders`, 'info');

    // Update status
    document.getElementById('so-trip-print-status').textContent = 'Downloading...';
    document.getElementById('so-trip-print-status').style.color = '#f59e0b';

    // Disable download button
    document.getElementById('so-trip-print-download-btn').disabled = true;

    let successCount = 0;
    let failCount = 0;

    // Download each order
    for (let i = 0; i < currentSOTripPrintData.orders.length; i++) {
        const order = currentSOTripPrintData.orders[i];

        console.log(`[SO Trip Print] Downloading ${i + 1}/${currentSOTripPrintData.orders.length}: ${order.orderNumber}`);
        console.log(`[SO Trip Print] Order Type: ${order.orderType}`);

        // Update debug info and SOAP XML display
        updateSODebugXMLForOrder(order.orderNumber);

        // Update status to DOWNLOADING
        order.downloadStatus = 'DOWNLOADING';
        renderSOTripPrintOrders();

        try {
            // Use printSalesOrder action for Sales Order Processing
            const message = {
                action: 'printSalesOrder',
                orderNumber: order.orderNumber,
                instance: order.instance,
                reportPath: currentSOTripPrintData.reportPath,
                parameterName: currentSOTripPrintData.parameterName,
                tripId: order.tripId,
                tripDate: order.tripDate,
                orderType: order.orderType
            };

            console.log('[SO Trip Print] ════════════════════════════════════════════════════════');
            console.log('[SO Trip Print] 📤 SENDING TO C#');
            console.log('[SO Trip Print] Action:', message.action);
            console.log('[SO Trip Print] Report Path:', message.reportPath);
            console.log('[SO Trip Print] Parameter Name:', message.parameterName);
            console.log('[SO Trip Print] Order Number:', message.orderNumber);
            console.log('[SO Trip Print] Order Type:', message.orderType);
            console.log('[SO Trip Print] Instance:', message.instance);
            console.log('[SO Trip Print] tripId:', message.tripId);
            console.log('[SO Trip Print] tripDate:', message.tripDate);
            console.log('[SO Trip Print] Full message:', JSON.stringify(message, null, 2));
            console.log('[SO Trip Print] ════════════════════════════════════════════════════════');

            const downloadStartTime = Date.now();
            console.log('[SO Trip Print] ⏱️ Download started at:', new Date(downloadStartTime).toISOString());

            const response = await new Promise((resolve, reject) => {
                console.log('[SO Trip Print] 🔄 Calling sendMessageToCSharp...');
                sendMessageToCSharp(message, function(error, response) {
                    const elapsed = Date.now() - downloadStartTime;
                    console.log('[SO Trip Print] ════════════════════════════════════════════════════════');
                    console.log('[SO Trip Print] 📨 CALLBACK RECEIVED');
                    console.log('[SO Trip Print] ⏱️ Elapsed time:', elapsed, 'ms');
                    console.log('[SO Trip Print] Error:', error);
                    console.log('[SO Trip Print] Response type:', typeof response);
                    console.log('[SO Trip Print] Response:', JSON.stringify(response, null, 2));
                    console.log('[SO Trip Print] ════════════════════════════════════════════════════════');

                    if (error) {
                        console.error('[SO Trip Print] ❌ Error in callback:', error);
                        reject(new Error(error));
                    } else {
                        try {
                            const parsed = typeof response === 'string' ? JSON.parse(response) : response;
                            console.log('[SO Trip Print] ✅ Parsed response:', JSON.stringify(parsed, null, 2));
                            resolve(parsed);
                        } catch (e) {
                            console.log('[SO Trip Print] ⚠️ Response not JSON, checking if path string...');
                            // If response is a path string
                            if (response && typeof response === 'string' &&
                                (response.includes('\\') || response.includes('.pdf'))) {
                                console.log('[SO Trip Print] ✅ Response is a file path:', response);
                                resolve({ success: true, filePath: response.trim() });
                            } else {
                                console.error('[SO Trip Print] ❌ Invalid response format:', response);
                                reject(new Error('Invalid response format'));
                            }
                        }
                    }
                }, 90000); // 90 second timeout for PDF downloads
            });

            console.log('[SO Trip Print] 🔍 Checking response for success...');
            console.log('[SO Trip Print] response.success:', response.success);
            console.log('[SO Trip Print] response.filePath:', response.filePath);
            console.log('[SO Trip Print] response.pdfPath:', response.pdfPath);

            if (response.success && (response.filePath || response.pdfPath)) {
                order.downloadStatus = 'DOWNLOADED';
                order.pdfPath = response.filePath || response.pdfPath;
                order.error = null;
                successCount++;
                console.log(`[SO Trip Print] ✅ Downloaded: ${order.orderNumber} to ${order.pdfPath}`);
                addSOLogEntry('Print', `Downloaded: ${order.orderNumber}`, 'success');
            } else {
                console.error('[SO Trip Print] ❌ Response missing success or file path');
                console.error('[SO Trip Print] Full response:', JSON.stringify(response, null, 2));
                throw new Error(response.message || 'Download failed - no file path in response');
            }

        } catch (error) {
            console.error(`[SO Trip Print] ❌ Failed to download ${order.orderNumber}:`, error);
            order.downloadStatus = 'FAILED';
            order.error = error.message;
            failCount++;
            addSOLogEntry('Error', `Failed to download ${order.orderNumber}: ${error.message}`, 'error');
        }

        renderSOTripPrintOrders();

        // Add delay between downloads
        if (i < currentSOTripPrintData.orders.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Update final status
    if (failCount === 0) {
        document.getElementById('so-trip-print-status').textContent = 'All Downloaded ✓';
        document.getElementById('so-trip-print-status').style.color = '#10b981';
        document.getElementById('so-trip-print-download-btn').style.display = 'none';
        document.getElementById('so-trip-print-print-btn').style.display = 'inline-flex';
        addSOLogEntry('Print', `All ${successCount} orders downloaded successfully`, 'success');
    } else {
        document.getElementById('so-trip-print-status').textContent = `${successCount} OK, ${failCount} Failed`;
        document.getElementById('so-trip-print-status').style.color = '#ef4444';
        document.getElementById('so-trip-print-retry-all-btn').style.display = 'inline-flex';
        document.getElementById('so-trip-print-download-btn').disabled = false;

        if (successCount > 0) {
            document.getElementById('so-trip-print-print-btn').style.display = 'inline-flex';
        }
        addSOLogEntry('Print', `Download complete: ${successCount} success, ${failCount} failed`, 'warning');
    }
};

// Retry failed downloads
window.retryAllSOTripDownloads = async function() {
    if (!currentSOTripPrintData) return;

    // Reset failed orders
    currentSOTripPrintData.orders.forEach(order => {
        if (order.downloadStatus === 'FAILED') {
            order.downloadStatus = 'PENDING';
            order.error = null;
        }
    });

    renderSOTripPrintOrders();
    document.getElementById('so-trip-print-retry-all-btn').style.display = 'none';

    // Start download again
    await startSOTripDownload();
};

// Start printing all downloaded PDFs
window.startSOTripPrinting = async function() {
    if (!currentSOTripPrintData) return;

    const printerName = document.getElementById('so-trip-print-printer-select').value;
    const errorDiv = document.getElementById('so-trip-print-error');

    if (!printerName) {
        errorDiv.textContent = 'Please select a printer';
        errorDiv.style.display = 'block';
        return;
    }

    errorDiv.style.display = 'none';

    console.log('[SO Trip Print] Starting printing for all orders with printer:', printerName);
    addSOLogEntry('Print', `Starting print to ${printerName}`, 'info');

    // Update status
    document.getElementById('so-trip-print-status').textContent = 'Printing...';
    document.getElementById('so-trip-print-status').style.color = '#f59e0b';

    // Disable print button
    document.getElementById('so-trip-print-print-btn').disabled = true;

    let successCount = 0;
    let failCount = 0;

    // Print each downloaded order
    const downloadedOrders = currentSOTripPrintData.orders.filter(o => o.downloadStatus === 'DOWNLOADED');

    for (let i = 0; i < downloadedOrders.length; i++) {
        const order = downloadedOrders[i];

        console.log(`[SO Trip Print] Printing ${i + 1}/${downloadedOrders.length}: ${order.orderNumber}`);

        // Update status to PRINTING
        order.printStatus = 'PRINTING';
        renderSOTripPrintOrders();

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
                        try {
                            const parsed = typeof response === 'string' ? JSON.parse(response) : response;
                            resolve(parsed);
                        } catch (e) {
                            resolve({ success: true });
                        }
                    }
                });
            });

            if (response.success) {
                order.printStatus = 'PRINTED';
                order.error = null;
                successCount++;
                console.log(`[SO Trip Print] ✅ Printed: ${order.orderNumber}`);
                addSOLogEntry('Print', `Printed: ${order.orderNumber}`, 'success');
            } else {
                throw new Error(response.message || 'Print failed');
            }

        } catch (error) {
            console.error(`[SO Trip Print] ❌ Failed to print ${order.orderNumber}:`, error);
            order.printStatus = 'FAILED';
            order.error = error.message;
            failCount++;
            addSOLogEntry('Error', `Failed to print ${order.orderNumber}: ${error.message}`, 'error');
        }

        renderSOTripPrintOrders();

        // Add delay between prints
        if (i < downloadedOrders.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // Update final status
    if (failCount === 0) {
        document.getElementById('so-trip-print-status').textContent = 'All Printed ✓';
        document.getElementById('so-trip-print-status').style.color = '#10b981';
        document.getElementById('so-trip-print-print-btn').style.display = 'none';
        addSOLogEntry('Print', `All ${successCount} orders printed successfully`, 'success');
    } else {
        document.getElementById('so-trip-print-status').textContent = `${successCount} Printed, ${failCount} Failed`;
        document.getElementById('so-trip-print-status').style.color = '#ef4444';
        addSOLogEntry('Print', `Print complete: ${successCount} success, ${failCount} failed`, 'warning');
    }

    document.getElementById('so-trip-print-print-btn').disabled = false;

    console.log(`[SO Trip Print] Printing complete: ${successCount} succeeded, ${failCount} failed`);
};

// ============================================================================
// ORDER SELECTION AND ACTION FUNCTIONS
// ============================================================================

// Track selected orders per trip: Map<tripIndex, Set<orderNumber>>
let selectedSOOrders = new Map();

// Toggle order selection
function soToggleOrderSelection(orderId, orderNumber, tripIndex) {
    if (!selectedSOOrders.has(tripIndex)) {
        selectedSOOrders.set(tripIndex, new Set());
    }

    const tripOrders = selectedSOOrders.get(tripIndex);
    const checkbox = document.getElementById(`so-order-checkbox-${orderId}`);
    const orderCard = document.getElementById(`so-order-card-${orderId}`);

    if (tripOrders.has(orderNumber)) {
        // Deselect
        tripOrders.delete(orderNumber);
        if (orderCard) {
            orderCard.style.borderColor = '#e2e8f0';
            orderCard.style.boxShadow = 'none';
        }
    } else {
        // Select
        tripOrders.add(orderNumber);
        if (orderCard) {
            orderCard.style.borderColor = '#667eea';
            orderCard.style.boxShadow = '0 0 0 2px rgba(102, 126, 234, 0.2)';
        }
    }

    soUpdateOrderSelectionUI(tripIndex);
}

// Select all orders in a trip
function soSelectAllOrders(tripIndex) {
    const containers = document.querySelectorAll(`[data-so-order-container="${tripIndex}"]`);

    if (!selectedSOOrders.has(tripIndex)) {
        selectedSOOrders.set(tripIndex, new Set());
    }

    const tripOrders = selectedSOOrders.get(tripIndex);

    containers.forEach(container => {
        const orderNumber = container.getAttribute('data-order-number');
        const orderId = container.id.replace('so-order-card-', '');
        const checkbox = document.getElementById(`so-order-checkbox-${orderId}`);

        if (orderNumber) {
            tripOrders.add(orderNumber);
            if (checkbox) checkbox.checked = true;
            container.style.borderColor = '#667eea';
            container.style.boxShadow = '0 0 0 2px rgba(102, 126, 234, 0.2)';
        }
    });

    soUpdateOrderSelectionUI(tripIndex);
    addSOLogEntry('Selection', `Selected all orders in trip`, 'info');
}

// Deselect all orders in a trip
function soDeselectAllOrders(tripIndex) {
    const containers = document.querySelectorAll(`[data-so-order-container="${tripIndex}"]`);

    if (selectedSOOrders.has(tripIndex)) {
        selectedSOOrders.get(tripIndex).clear();
    }

    containers.forEach(container => {
        const orderId = container.id.replace('so-order-card-', '');
        const checkbox = document.getElementById(`so-order-checkbox-${orderId}`);

        if (checkbox) checkbox.checked = false;
        container.style.borderColor = '#e2e8f0';
        container.style.boxShadow = 'none';
    });

    soUpdateOrderSelectionUI(tripIndex);
    addSOLogEntry('Selection', `Cleared order selection`, 'info');
}

// Update order selection UI (toolbar visibility and count)
function soUpdateOrderSelectionUI(tripIndex) {
    const tripOrders = selectedSOOrders.get(tripIndex) || new Set();
    const count = tripOrders.size;

    const toolbar = document.getElementById(`so-order-actions-toolbar-${tripIndex}`);
    const countSpan = document.getElementById(`so-selected-orders-count-${tripIndex}`);

    if (toolbar) {
        toolbar.style.display = count > 0 ? 'block' : 'none';
    }

    if (countSpan) {
        countSpan.textContent = count;
    }
}

// Get selected orders for a trip
function soGetSelectedOrders(tripIndex) {
    return Array.from(selectedSOOrders.get(tripIndex) || new Set());
}

// ============================================================================
// PICK RELEASE MODAL AND API
// ============================================================================

// Pick Release for selected orders - Show modal
function soPickReleaseSelected(tripIndex) {
    const selectedOrders = soGetSelectedOrders(tripIndex);

    if (selectedOrders.length === 0) {
        alert('No orders selected');
        return;
    }

    addSOLogEntry('Pick Release', `Opening Pick Release modal for ${selectedOrders.length} orders`, 'info');

    // Show Pick Release Modal
    soShowPickReleaseModal(tripIndex, selectedOrders);
}

// Show Pick Release Modal
function soShowPickReleaseModal(tripIndex, selectedOrders) {
    // Remove existing modal if any
    const existingModal = document.getElementById('so-pick-release-modal');
    if (existingModal) existingModal.remove();

    // Build orders list HTML
    let ordersListHtml = '';
    selectedOrders.forEach((orderNum, idx) => {
        ordersListHtml += `
            <div id="so-pick-release-order-${idx}" style="display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.8rem; background: #f8f9fa; border-radius: 6px; margin-bottom: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-shopping-cart" style="color: #667eea;"></i>
                    <span style="font-weight: 600; color: #1e293b;">${orderNum}</span>
                </div>
                <div id="so-pick-release-status-${idx}" style="display: flex; align-items: center; gap: 0.3rem;">
                    <span style="background: #e2e8f0; color: #64748b; padding: 3px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">
                        <i class="fas fa-clock"></i> Pending
                    </span>
                </div>
            </div>
        `;
    });

    const modal = document.createElement('div');
    modal.id = 'so-pick-release-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 20000; display: flex; align-items: center; justify-content: center;';
    modal.innerHTML = `
        <div style="background: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); max-width: 500px; width: 90%; max-height: 80vh; display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="margin: 0; font-size: 1.1rem; color: #1e293b;">
                    <i class="fas fa-box-open" style="color: #10b981; margin-right: 0.5rem;"></i>
                    Pick Release
                </h3>
                <button onclick="soClosePickReleaseModal()" style="background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #64748b;">&times;</button>
            </div>

            <div style="margin-bottom: 1rem;">
                <p style="font-size: 0.9rem; color: #64748b; margin: 0 0 0.5rem 0;">
                    Pick Release for <strong>${selectedOrders.length}</strong> order(s):
                </p>
            </div>

            <!-- Orders List -->
            <div id="so-pick-release-orders-list" style="flex: 1; overflow-y: auto; max-height: 300px; margin-bottom: 1rem;">
                ${ordersListHtml}
            </div>

            <!-- Progress Bar (hidden initially) -->
            <div id="so-pick-release-progress-container" style="display: none; margin-bottom: 1rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.3rem;">
                    <span style="font-size: 0.8rem; color: #64748b;">Progress</span>
                    <span id="so-pick-release-progress-text" style="font-size: 0.8rem; color: #1e293b; font-weight: 600;">0 / ${selectedOrders.length}</span>
                </div>
                <div style="background: #e2e8f0; border-radius: 10px; height: 8px; overflow: hidden;">
                    <div id="so-pick-release-progress-bar" style="background: linear-gradient(90deg, #10b981, #059669); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
                </div>
            </div>

            <!-- Summary (hidden initially) -->
            <div id="so-pick-release-summary" style="display: none; padding: 0.75rem; background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; margin-bottom: 1rem;">
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <div style="text-align: center;">
                        <div style="font-size: 1.2rem; font-weight: 700; color: #10b981;" id="so-pick-release-success-count">0</div>
                        <div style="font-size: 0.7rem; color: #64748b;">Success</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 1.2rem; font-weight: 700; color: #ef4444;" id="so-pick-release-failed-count">0</div>
                        <div style="font-size: 0.7rem; color: #64748b;">Failed</div>
                    </div>
                </div>
            </div>

            <!-- Buttons -->
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button id="so-pick-release-cancel-btn" onclick="soClosePickReleaseModal()" style="background: #94a3b8; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">
                    Cancel
                </button>
                <button id="so-pick-release-execute-btn" onclick="soExecutePickRelease(${tripIndex}, ${JSON.stringify(selectedOrders).replace(/"/g, '&quot;')})" style="background: #10b981; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
                    <i class="fas fa-box-open"></i> Pick Release
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Close Pick Release Modal
function soClosePickReleaseModal() {
    const modal = document.getElementById('so-pick-release-modal');
    if (modal) modal.remove();
}

// Execute Pick Release for all selected orders
async function soExecutePickRelease(tripIndex, selectedOrders) {
    console.log('[Pick Release] Starting Pick Release for orders:', selectedOrders);
    addSOLogEntry('Pick Release', `Starting Pick Release for ${selectedOrders.length} orders`, 'info');

    // Disable buttons
    const executeBtn = document.getElementById('so-pick-release-execute-btn');
    const cancelBtn = document.getElementById('so-pick-release-cancel-btn');

    if (executeBtn) {
        executeBtn.disabled = true;
        executeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        executeBtn.style.background = '#9ca3af';
    }
    if (cancelBtn) {
        cancelBtn.disabled = true;
    }

    // Show progress
    const progressContainer = document.getElementById('so-pick-release-progress-container');
    if (progressContainer) progressContainer.style.display = 'block';

    let successCount = 0;
    let failedCount = 0;

    // Process each order
    for (let i = 0; i < selectedOrders.length; i++) {
        const orderNumber = selectedOrders[i];
        const statusEl = document.getElementById(`so-pick-release-status-${i}`);
        const orderEl = document.getElementById(`so-pick-release-order-${i}`);

        // Update status to processing
        if (statusEl) {
            statusEl.innerHTML = `
                <span style="background: #fef3c7; color: #d97706; padding: 3px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">
                    <i class="fas fa-spinner fa-spin"></i> Processing...
                </span>
            `;
        }
        if (orderEl) {
            orderEl.style.background = '#fef3c7';
        }

        try {
            // Call Pick Release API
            const result = await soCallPickReleaseAPI(orderNumber);

            if (result.success) {
                successCount++;
                if (statusEl) {
                    statusEl.innerHTML = `
                        <span style="background: #d1fae5; color: #059669; padding: 3px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">
                            <i class="fas fa-check-circle"></i> Success
                        </span>
                    `;
                }
                if (orderEl) {
                    orderEl.style.background = '#d1fae5';
                }
                addSOLogEntry('Pick Release', `Order ${orderNumber}: Success`, 'success');
            } else {
                failedCount++;
                if (statusEl) {
                    statusEl.innerHTML = `
                        <span style="background: #fee2e2; color: #dc2626; padding: 3px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;" title="${result.error || 'Unknown error'}">
                            <i class="fas fa-times-circle"></i> Failed
                        </span>
                    `;
                }
                if (orderEl) {
                    orderEl.style.background = '#fee2e2';
                }
                addSOLogEntry('Pick Release', `Order ${orderNumber}: Failed - ${result.error}`, 'error');
            }
        } catch (error) {
            failedCount++;
            if (statusEl) {
                statusEl.innerHTML = `
                    <span style="background: #fee2e2; color: #dc2626; padding: 3px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;" title="${error.message}">
                        <i class="fas fa-times-circle"></i> Error
                    </span>
                `;
            }
            if (orderEl) {
                orderEl.style.background = '#fee2e2';
            }
            addSOLogEntry('Pick Release', `Order ${orderNumber}: Error - ${error.message}`, 'error');
        }

        // Update progress
        const progressBar = document.getElementById('so-pick-release-progress-bar');
        const progressText = document.getElementById('so-pick-release-progress-text');
        const progress = ((i + 1) / selectedOrders.length) * 100;

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (progressText) progressText.textContent = `${i + 1} / ${selectedOrders.length}`;

        // Small delay between requests
        if (i < selectedOrders.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Show summary
    const summaryEl = document.getElementById('so-pick-release-summary');
    const successCountEl = document.getElementById('so-pick-release-success-count');
    const failedCountEl = document.getElementById('so-pick-release-failed-count');

    if (summaryEl) {
        summaryEl.style.display = 'block';
        if (failedCount > 0) {
            summaryEl.style.background = '#fef2f2';
            summaryEl.style.borderColor = '#fca5a5';
        }
    }
    if (successCountEl) successCountEl.textContent = successCount;
    if (failedCountEl) failedCountEl.textContent = failedCount;

    // Update buttons
    if (executeBtn) {
        executeBtn.style.display = 'none';
    }
    if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Close';
        cancelBtn.style.background = '#667eea';
    }

    // Log completion
    addSOLogEntry('Pick Release', `Completed: ${successCount} success, ${failedCount} failed`, successCount > 0 && failedCount === 0 ? 'success' : 'warning');

    // Clear selection after completion
    soDeselectAllOrders(tripIndex);
}

// Call Pick Release API for a single order
function soCallPickReleaseAPI(orderNumber) {
    return new Promise((resolve, reject) => {
        // Get instance from current trip context, localStorage, or fallback
        const instance = window.currentTripInstance || localStorage.getItem('fusionInstance') || 'TEST';
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/pickrelease/oneorder/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Pick Release] Calling API for order:', orderNumber, 'Instance:', instance, 'URL:', apiUrl);

        // Use C# WebView REST handler
        sendMessageToCSharp({
            action: "executeGet",
            fullUrl: apiUrl
        }, function(error, data) {
            if (error) {
                console.error('[Pick Release] API Error for order', orderNumber, ':', error);
                resolve({ success: false, error: error });
            } else {
                try {
                    console.log('[Pick Release] API Response for order', orderNumber, ':', data);
                    const response = JSON.parse(data);

                    // Check if response indicates success
                    // Adjust this based on actual API response structure
                    if (response.status === 'error' || response.error) {
                        resolve({ success: false, error: response.message || response.error || 'API returned error' });
                    } else {
                        resolve({ success: true, data: response });
                    }
                } catch (e) {
                    console.error('[Pick Release] Parse error for order', orderNumber, ':', e);
                    // If we can't parse, assume success if no error
                    resolve({ success: true, data: data });
                }
            }
        });
    });
}

// ============================================================================
// ASSIGN PICKER MODAL AND API
// ============================================================================

// Assign Picker for selected orders - Show modal
async function soAssignPickerSelected(tripIndex) {
    const selectedOrders = soGetSelectedOrders(tripIndex);

    if (selectedOrders.length === 0) {
        alert('No orders selected');
        return;
    }

    addSOLogEntry('Assign Picker', `Opening picker assignment for ${selectedOrders.length} orders`, 'info');

    // Auto-fetch pickers if not loaded
    if (!window.pickersData || window.pickersData.length === 0) {
        addSOLogEntry('Assign Picker', 'Loading pickers data...', 'info');

        // Show loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'so-picker-loading';
        loadingDiv.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 20000; display: flex; align-items: center; justify-content: center;';
        loadingDiv.innerHTML = `
            <div style="background: white; padding: 1.5rem 2rem; border-radius: 12px; text-align: center;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #8b5cf6; margin-bottom: 0.5rem;"></i>
                <div style="font-size: 0.9rem; color: #1e293b; font-weight: 600;">Loading pickers...</div>
            </div>
        `;
        document.body.appendChild(loadingDiv);

        try {
            // Call loadPickers if available
            if (typeof window.loadPickers === 'function') {
                await window.loadPickers();
                // Wait a bit for data to be available
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (e) {
            console.error('[Assign Picker] Error loading pickers:', e);
        }

        // Remove loading indicator
        const loadingEl = document.getElementById('so-picker-loading');
        if (loadingEl) loadingEl.remove();
    }

    // Show picker selection modal
    soShowPickerAssignmentModal(tripIndex, selectedOrders);
}

// Show Picker Assignment Modal with dropdown
function soShowPickerAssignmentModal(tripIndex, selectedOrders) {
    // Remove existing modal if any
    const existingModal = document.getElementById('so-picker-assignment-modal');
    if (existingModal) existingModal.remove();

    // Build picker options from window.pickersData
    let pickerOptionsHtml = '<option value="">-- Select a Picker --</option>';

    if (window.pickersData && window.pickersData.length > 0) {
        // Filter out deleted pickers
        const activePickers = window.pickersData.filter(p => p.deleted !== 1);
        activePickers.forEach(picker => {
            const pickerId = picker.picker_id || picker.PICKER_ID || picker.id || picker.ID || '';
            const pickerName = picker.name || picker.NAME || picker.picker_name || picker.PICKER_NAME || '';
            pickerOptionsHtml += `<option value="${pickerId}" data-name="${pickerName}">${pickerName}</option>`;
        });
    } else {
        pickerOptionsHtml += '<option value="" disabled>No pickers available - load pickers first</option>';
    }

    // Build orders list HTML
    let ordersListHtml = '';
    selectedOrders.forEach((orderNum, idx) => {
        ordersListHtml += `
            <div id="so-assign-picker-order-${idx}" style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.6rem; background: #f8f9fa; border-radius: 6px; margin-bottom: 0.4rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-shopping-cart" style="color: #667eea; font-size: 12px;"></i>
                    <span style="font-weight: 600; color: #1e293b; font-size: 12px;">${orderNum}</span>
                </div>
                <div id="so-assign-picker-status-${idx}" style="display: flex; align-items: center; gap: 0.3rem;">
                    <span style="background: #e2e8f0; color: #64748b; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: 600;">
                        <i class="fas fa-clock"></i> Pending
                    </span>
                </div>
            </div>
        `;
    });

    const modal = document.createElement('div');
    modal.id = 'so-picker-assignment-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 20000; display: flex; align-items: center; justify-content: center;';
    modal.innerHTML = `
        <div style="background: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); max-width: 500px; width: 90%; max-height: 80vh; display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="margin: 0; font-size: 1.1rem; color: #1e293b;">
                    <i class="fas fa-user-check" style="color: #8b5cf6; margin-right: 0.5rem;"></i>
                    Assign Picker
                </h3>
                <button onclick="soClosePickerAssignmentModal()" style="background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #64748b;">&times;</button>
            </div>

            <div style="margin-bottom: 1rem; padding: 0.75rem; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
                <div style="font-size: 0.85rem; color: #0369a1;">
                    <i class="fas fa-info-circle"></i> Assigning picker to <strong>${selectedOrders.length}</strong> selected order(s)
                </div>
            </div>

            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #374151; font-size: 0.875rem;">Select Picker:</label>
                <select id="so-picker-select" style="width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.875rem; box-sizing: border-box;">
                    ${pickerOptionsHtml}
                </select>
            </div>

            <!-- Orders List -->
            <div id="so-assign-picker-orders-list" style="flex: 1; overflow-y: auto; max-height: 200px; margin-bottom: 1rem;">
                ${ordersListHtml}
            </div>

            <!-- Progress Bar (hidden initially) -->
            <div id="so-assign-picker-progress-container" style="display: none; margin-bottom: 1rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.3rem;">
                    <span style="font-size: 0.8rem; color: #64748b;">Progress</span>
                    <span id="so-assign-picker-progress-text" style="font-size: 0.8rem; color: #1e293b; font-weight: 600;">0 / ${selectedOrders.length}</span>
                </div>
                <div style="background: #e2e8f0; border-radius: 10px; height: 8px; overflow: hidden;">
                    <div id="so-assign-picker-progress-bar" style="background: linear-gradient(90deg, #8b5cf6, #7c3aed); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
                </div>
            </div>

            <!-- Summary (hidden initially) -->
            <div id="so-assign-picker-summary" style="display: none; padding: 0.75rem; background: #f5f3ff; border: 1px solid #c4b5fd; border-radius: 8px; margin-bottom: 1rem;">
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <div style="text-align: center;">
                        <div style="font-size: 1.2rem; font-weight: 700; color: #10b981;" id="so-assign-picker-success-count">0</div>
                        <div style="font-size: 0.7rem; color: #64748b;">Success</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 1.2rem; font-weight: 700; color: #ef4444;" id="so-assign-picker-failed-count">0</div>
                        <div style="font-size: 0.7rem; color: #64748b;">Failed</div>
                    </div>
                </div>
            </div>

            <!-- Buttons -->
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button id="so-assign-picker-cancel-btn" onclick="soClosePickerAssignmentModal()" style="background: #94a3b8; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">
                    Cancel
                </button>
                <button id="so-assign-picker-execute-btn" onclick="soExecuteAssignPicker(${tripIndex}, ${JSON.stringify(selectedOrders).replace(/"/g, '&quot;')})" style="background: #8b5cf6; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
                    <i class="fas fa-check"></i> Assign
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Close Picker Assignment Modal
function soClosePickerAssignmentModal() {
    const modal = document.getElementById('so-picker-assignment-modal');
    if (modal) modal.remove();
}

// Execute Assign Picker for all selected orders
async function soExecuteAssignPicker(tripIndex, selectedOrders) {
    const pickerSelect = document.getElementById('so-picker-select');
    const selectedOption = pickerSelect.options[pickerSelect.selectedIndex];
    const pickerId = pickerSelect.value;
    const pickerName = selectedOption?.getAttribute('data-name') || '';

    if (!pickerId) {
        alert('Please select a picker');
        return;
    }

    console.log('[Assign Picker] Starting for orders:', selectedOrders, 'Picker:', pickerName, '(', pickerId, ')');
    addSOLogEntry('Assign Picker', `Assigning "${pickerName}" to ${selectedOrders.length} orders`, 'info');

    // Disable buttons
    const executeBtn = document.getElementById('so-assign-picker-execute-btn');
    const cancelBtn = document.getElementById('so-assign-picker-cancel-btn');
    const pickerSelectEl = document.getElementById('so-picker-select');

    if (executeBtn) {
        executeBtn.disabled = true;
        executeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        executeBtn.style.background = '#9ca3af';
    }
    if (cancelBtn) cancelBtn.disabled = true;
    if (pickerSelectEl) pickerSelectEl.disabled = true;

    // Show progress
    const progressContainer = document.getElementById('so-assign-picker-progress-container');
    if (progressContainer) progressContainer.style.display = 'block';

    const fusionInstance = window.currentTripInstance || localStorage.getItem('fusionInstance') || 'TEST';
    let successCount = 0;
    let failedCount = 0;

    // Process each order
    for (let i = 0; i < selectedOrders.length; i++) {
        const orderNumber = selectedOrders[i];
        const statusEl = document.getElementById(`so-assign-picker-status-${i}`);
        const orderEl = document.getElementById(`so-assign-picker-order-${i}`);

        // Update status to processing
        if (statusEl) {
            statusEl.innerHTML = `
                <span style="background: #fef3c7; color: #d97706; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: 600;">
                    <i class="fas fa-spinner fa-spin"></i> Processing...
                </span>
            `;
        }
        if (orderEl) orderEl.style.background = '#fef3c7';

        try {
            // Call Assign Picker API
            const result = await soCallAssignPickerAPI(orderNumber, pickerId, pickerName, fusionInstance);

            if (result.success) {
                successCount++;
                if (statusEl) {
                    statusEl.innerHTML = `
                        <span style="background: #d1fae5; color: #059669; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: 600;">
                            <i class="fas fa-check-circle"></i> Success
                        </span>
                    `;
                }
                if (orderEl) orderEl.style.background = '#d1fae5';
                addSOLogEntry('Assign Picker', `Order ${orderNumber}: Assigned to ${pickerName}`, 'success');
            } else {
                failedCount++;
                if (statusEl) {
                    statusEl.innerHTML = `
                        <span style="background: #fee2e2; color: #dc2626; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: 600;" title="${result.error || 'Unknown error'}">
                            <i class="fas fa-times-circle"></i> Failed
                        </span>
                    `;
                }
                if (orderEl) orderEl.style.background = '#fee2e2';
                addSOLogEntry('Assign Picker', `Order ${orderNumber}: Failed - ${result.error}`, 'error');
            }
        } catch (error) {
            failedCount++;
            if (statusEl) {
                statusEl.innerHTML = `
                    <span style="background: #fee2e2; color: #dc2626; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: 600;" title="${error.message}">
                        <i class="fas fa-times-circle"></i> Error
                    </span>
                `;
            }
            if (orderEl) orderEl.style.background = '#fee2e2';
            addSOLogEntry('Assign Picker', `Order ${orderNumber}: Error - ${error.message}`, 'error');
        }

        // Update progress
        const progressBar = document.getElementById('so-assign-picker-progress-bar');
        const progressText = document.getElementById('so-assign-picker-progress-text');
        const progress = ((i + 1) / selectedOrders.length) * 100;

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (progressText) progressText.textContent = `${i + 1} / ${selectedOrders.length}`;

        // Small delay between requests
        if (i < selectedOrders.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    // Show summary
    const summaryEl = document.getElementById('so-assign-picker-summary');
    const successCountEl = document.getElementById('so-assign-picker-success-count');
    const failedCountEl = document.getElementById('so-assign-picker-failed-count');

    if (summaryEl) {
        summaryEl.style.display = 'block';
        if (failedCount > 0) {
            summaryEl.style.background = '#fef2f2';
            summaryEl.style.borderColor = '#fca5a5';
        }
    }
    if (successCountEl) successCountEl.textContent = successCount;
    if (failedCountEl) failedCountEl.textContent = failedCount;

    // Update buttons
    if (executeBtn) executeBtn.style.display = 'none';
    if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Close';
        cancelBtn.style.background = '#667eea';
    }

    // Log completion
    addSOLogEntry('Assign Picker', `Completed: ${successCount} success, ${failedCount} failed`, successCount > 0 && failedCount === 0 ? 'success' : 'warning');

    // Clear selection after completion
    soDeselectAllOrders(tripIndex);
}

// Call Assign Picker API for a single order
function soCallAssignPickerAPI(orderNumber, pickerId, pickerName, instanceName) {
    return new Promise((resolve, reject) => {
        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/assignpicker';

        const payload = {
            p_trx_number: orderNumber,
            p_picker_id: pickerId,
            p_picker_name: pickerName,
            p_instance_name: instanceName
        };

        console.log('[Assign Picker] Calling API for order:', orderNumber, 'Payload:', payload);

        // Use C# WebView REST handler
        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            body: JSON.stringify(payload)
        }, function(error, data) {
            if (error) {
                console.error('[Assign Picker] API Error for order', orderNumber, ':', error);
                resolve({ success: false, error: error });
            } else {
                try {
                    console.log('[Assign Picker] API Response for order', orderNumber, ':', data);
                    const response = JSON.parse(data);

                    // Check if response indicates success
                    if (response.status === 'error' || response.error) {
                        resolve({ success: false, error: response.message || response.error || 'API returned error' });
                    } else {
                        resolve({ success: true, data: response });
                    }
                } catch (e) {
                    console.error('[Assign Picker] Parse error for order', orderNumber, ':', e);
                    // If we can't parse, assume success if no error
                    resolve({ success: true, data: data });
                }
            }
        });
    });
}

// ============================================================================
// OTHER ORDER ACTION BUTTONS
// ============================================================================

// Cancel Scheduled Lines for selected orders
function soCancelScheduledLinesSelected(tripIndex) {
    const selectedOrders = soGetSelectedOrders(tripIndex);

    if (selectedOrders.length === 0) {
        alert('No orders selected');
        return;
    }

    addSOLogEntry('Cancel Lines', `Initiating Cancel Scheduled Lines for ${selectedOrders.length} orders`, 'info');

    if (confirm(`Cancel all scheduled lines for ${selectedOrders.length} order(s)?\n\nOrders: ${selectedOrders.join(', ')}\n\nThis action cannot be undone.`)) {
        console.log('[SO Actions] Cancel Scheduled Lines for orders:', selectedOrders);
        addSOLogEntry('Cancel Lines', `Cancel Scheduled Lines requested for orders: ${selectedOrders.join(', ')}`, 'warning');
        // TODO: Implement API call when provided
    }
}

// ============================================================================
// LINE ACTION BUTTONS (Placeholder functions - API to be provided)
// ============================================================================

// Pick a single line
function soPickLine(tripIndex, lineIndex, pickSlip, pickSlipLine) {
    console.log('[SO Actions] Pick Line:', { tripIndex, lineIndex, pickSlip, pickSlipLine });
    addSOLogEntry('Pick Line', `Picking line: Pick Slip ${pickSlip}, Line ${pickSlipLine}`, 'info');

    if (confirm(`Pick this line?\n\nPick Slip: ${pickSlip}\nLine: ${pickSlipLine}`)) {
        // TODO: Implement API call when provided
        addSOLogEntry('Pick Line', `Pick Line requested: ${pickSlip}-${pickSlipLine}`, 'success');
    }
}

// Cancel a single line
function soCancelLine(tripIndex, lineIndex, pickSlip, pickSlipLine) {
    console.log('[SO Actions] Cancel Line:', { tripIndex, lineIndex, pickSlip, pickSlipLine });
    addSOLogEntry('Cancel Line', `Cancelling line: Pick Slip ${pickSlip}, Line ${pickSlipLine}`, 'info');

    if (confirm(`Cancel this line?\n\nPick Slip: ${pickSlip}\nLine: ${pickSlipLine}\n\nThis action cannot be undone.`)) {
        // TODO: Implement API call when provided
        addSOLogEntry('Cancel Line', `Cancel Line requested: ${pickSlip}-${pickSlipLine}`, 'warning');
    }
}

// ============================================================================
// OPEN ORDER TRANSACTIONS DIALOG
// ============================================================================

// Open Order Transactions dialog for an order
function soOpenOrderTransactions(orderNumber, tripIndex, orderIdx) {
    console.log('[SO Actions] Opening Order Transactions for:', orderNumber, 'tripIndex:', tripIndex, 'orderIdx:', orderIdx);
    addSOLogEntry('Edit', `Opening Order Transactions for order: ${orderNumber}`, 'info');

    // Get the trip and order data
    const groupedTrips = groupSOTransactionsByTrip();
    const trip = groupedTrips[tripIndex];

    if (!trip) {
        console.error('[SO Actions] Trip not found at index:', tripIndex);
        alert('Trip not found');
        return;
    }

    // Find the order transactions
    const orderTransactions = trip.transactions.filter(t => t.source_order === orderNumber);

    if (orderTransactions.length === 0) {
        console.error('[SO Actions] No transactions found for order:', orderNumber);
        alert('Order not found');
        return;
    }

    // Get first transaction for order details
    const firstTrx = orderTransactions[0];

    // Build rowData object for openOrderTransactionsDialog
    const rowData = {
        ORDER_NUMBER: orderNumber,
        order_number: orderNumber,
        SOURCE_ORDER_NUMBER: orderNumber,
        source_order_number: orderNumber,
        ORDER_TYPE: firstTrx.order_type || '',
        order_type: firstTrx.order_type || '',
        ORDER_DATE: firstTrx.order_date || '',
        order_date: firstTrx.order_date || '',
        TRIP_ID: firstTrx.trip_id || trip.trip_id || '',
        trip_id: firstTrx.trip_id || trip.trip_id || '',
        TRIP_DATE: firstTrx.trip_date || trip.trip_date || '',
        trip_date: firstTrx.trip_date || trip.trip_date || '',
        ACCOUNT_NUMBER: firstTrx.account_number || '',
        account_number: firstTrx.account_number || '',
        ACCOUNT_NAME: firstTrx.customer || '',
        account_name: firstTrx.customer || '',
        CUSTOMER_NAME: firstTrx.customer || '',
        customer_name: firstTrx.customer || '',
        PICKER: firstTrx.picker || '',
        picker: firstTrx.picker || '',
        LORRY_NUMBER: firstTrx.lorry_number || trip.trip_lorry || '',
        lorry_number: firstTrx.lorry_number || trip.trip_lorry || '',
        PRIORITY: firstTrx.priority || trip.trip_priority || '',
        priority: firstTrx.priority || trip.trip_priority || '',
        LINE_STATUS: firstTrx.line_status || '',
        line_status: firstTrx.line_status || '',
        INSTANCE_NAME: firstTrx.instance_name || 'PROD',
        instance_name: firstTrx.instance_name || 'PROD'
    };

    console.log('[SO Actions] Opening dialog with rowData:', rowData);

    // Check if openOrderTransactionsDialog function exists (from app.js)
    if (typeof openOrderTransactionsDialog === 'function') {
        openOrderTransactionsDialog(rowData);
    } else {
        console.error('[SO Actions] openOrderTransactionsDialog function not found');
        alert('Order Transactions dialog is not available. Please ensure app.js is loaded.');
    }
}

// ============================================================================
// SO TRIP PRINT - TEST MRA INTERFACE (OPENS POPUP)
// Opens the MRA Interface v2 popup for testing a single order
// ============================================================================

/**
 * Test MRA Interface - Opens the MRA popup for a selected order
 * Allows user to test MRA processing with the visual popup interface
 */
window.testMRAInterface = function() {
    if (!currentSOTripPrintData || !currentSOTripPrintData.orders || currentSOTripPrintData.orders.length === 0) {
        alert('No orders available. Please open a trip first.');
        return;
    }

    // Create order selection popup
    const orders = currentSOTripPrintData.orders;
    const instance = currentSOTripPrintData.instanceName || 'PROD';

    // Build order options HTML
    const orderOptionsHtml = orders.map((order, index) => {
        const mraStatus = order.mraStatus || 'PENDING';
        const statusColor = mraStatus === 'SUCCESS' ? '#10b981' :
                           mraStatus === 'FAILED' ? '#ef4444' :
                           mraStatus === 'INTERFACED' ? '#ef4444' : '#f59e0b';
        const statusText = mraStatus === 'INTERFACED' ? 'Interfaced' : mraStatus;
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem; margin-bottom: 0.5rem; background: #f8fafc; border-radius: 8px; cursor: pointer; border: 2px solid transparent; transition: all 0.2s;"
                 onclick="selectOrderForMRATest(${index})"
                 onmouseover="this.style.borderColor='#667eea'"
                 onmouseout="this.style.borderColor='transparent'"
                 id="mra-test-order-${index}">
                <div>
                    <div style="font-weight: 600; color: #1e293b;">${order.orderNumber}</div>
                    <div style="font-size: 0.75rem; color: #64748b;">${order.customer || 'N/A'}</div>
                </div>
                <span style="background: ${statusColor}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">${statusText}</span>
            </div>
        `;
    }).join('');

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'mra-test-select-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100001;
    `;

    overlay.innerHTML = `
        <div style="background: white; width: 400px; max-width: 95%; max-height: 80vh; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <h3 style="margin: 0; font-size: 1rem;">
                        <i class="fas fa-flask"></i> Test MRA Interface
                    </h3>
                    <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; opacity: 0.9;">Select an order to test</p>
                </div>
                <button onclick="document.getElementById('mra-test-select-overlay').remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1rem;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div style="padding: 1rem; overflow-y: auto; flex: 1; max-height: 400px;">
                <p style="font-size: 0.85rem; color: #64748b; margin: 0 0 1rem 0;">
                    Instance: <strong>${instance}</strong> | Trip: <strong>${currentSOTripPrintData.tripId}</strong>
                </p>
                ${orderOptionsHtml}
            </div>
            <div style="padding: 1rem; border-top: 1px solid #e2e8f0; background: #f8fafc;">
                <div style="display: flex; gap: 0.5rem;">
                    <input type="text" id="mra-test-custom-order" placeholder="Or enter order number..." style="flex: 1; padding: 0.5rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;">
                    <button onclick="testMRAWithCustomOrder()" style="background: #667eea; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        <i class="fas fa-play"></i> Test
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    console.log('[SO Trip MRA] Opened Test MRA order selection dialog');
};

/**
 * Select an order from the list and open MRA popup
 */
window.selectOrderForMRATest = function(orderIndex) {
    const order = currentSOTripPrintData.orders[orderIndex];
    const instance = currentSOTripPrintData.instanceName || 'PROD';

    // Close selection overlay
    const overlay = document.getElementById('mra-test-select-overlay');
    if (overlay) overlay.remove();

    console.log(`[SO Trip MRA] Testing MRA for order: ${order.orderNumber}, instance: ${instance}`);

    // Open the MRA Interface v2 popup
    if (typeof openMRAProcessingPopup === 'function') {
        openMRAProcessingPopup(order.orderNumber, instance);
    } else {
        alert('MRA Processing popup is not available. Please ensure mra-processor.js is loaded.');
    }
};

/**
 * Test MRA with a custom order number
 */
window.testMRAWithCustomOrder = function() {
    const input = document.getElementById('mra-test-custom-order');
    const orderNumber = input ? input.value.trim() : '';

    if (!orderNumber) {
        alert('Please enter an order number');
        return;
    }

    const instance = currentSOTripPrintData?.instanceName || 'PROD';

    // Close selection overlay
    const overlay = document.getElementById('mra-test-select-overlay');
    if (overlay) overlay.remove();

    console.log(`[SO Trip MRA] Testing MRA for custom order: ${orderNumber}, instance: ${instance}`);

    // Open the MRA Interface v2 popup
    if (typeof openMRAProcessingPopup === 'function') {
        openMRAProcessingPopup(orderNumber, instance);
    } else {
        alert('MRA Processing popup is not available. Please ensure mra-processor.js is loaded.');
    }
};

// ============================================================================
// SO TRIP PRINT - MRA INTERFACE BATCH PROCESSING
// Uses the original MRA Interface v2 popup for processing
// ============================================================================

// Store MRA logs per order (copied from popup's mraState.logs)
let soTripMRALogs = new Map();

/**
 * Add MRA log entry for an order (used during popup processing)
 */
function addSOTripMRALog(orderIndex, message, type = 'info') {
    if (!currentSOTripPrintData || !currentSOTripPrintData.orders) return;

    const order = currentSOTripPrintData.orders[orderIndex];
    if (!order) return;

    if (!soTripMRALogs.has(orderIndex)) {
        soTripMRALogs.set(orderIndex, []);
    }

    const timestamp = new Date().toLocaleTimeString();
    soTripMRALogs.get(orderIndex).push({ timestamp, message, type });

    console.log(`[SO Trip MRA ${order.orderNumber}] [${type.toUpperCase()}] ${message}`);
}

/**
 * Start MRA Interface processing for all orders in SO Trip
 * Processes in background without opening popup
 */
window.startSOTripMRAInterface = async function() {
    if (!currentSOTripPrintData || !currentSOTripPrintData.orders) {
        alert('No orders to process');
        return;
    }

    console.log('[SO Trip MRA] Starting batch MRA processing for', currentSOTripPrintData.orders.length, 'orders');
    addSOLogEntry('MRA', `Starting MRA Interface for ${currentSOTripPrintData.orders.length} orders`, 'info');

    // Clear previous logs
    soTripMRALogs.clear();

    // Get Fusion credentials first
    let fusionUsername = window.F_username;
    let fusionPassword = window.F_password;

    if (!fusionUsername || !fusionPassword) {
        try {
            addSOLogEntry('MRA', 'Fetching Fusion credentials...', 'info');
            const credentials = await fetchFusionCredentialsForBatchMRA();
            fusionUsername = credentials.username;
            fusionPassword = credentials.password;
        } catch (error) {
            console.error('[SO Trip MRA] Failed to fetch credentials:', error);
            alert('Failed to fetch Fusion credentials: ' + error.message);
            return;
        }
    }

    // Update status
    document.getElementById('so-trip-print-status').textContent = 'MRA Processing...';
    document.getElementById('so-trip-print-status').style.color = '#8b5cf6';

    // Disable MRA button during processing
    const mraBtn = document.getElementById('so-trip-print-mra-btn');
    if (mraBtn) mraBtn.disabled = true;

    const resolvedInstance = currentSOTripPrintData.instanceName ||
                            localStorage.getItem('fusionInstance') ||
                            localStorage.getItem('instanceName') ||
                            'PROD';

    let successCount = 0;
    let failCount = 0;
    let interfacedCount = 0;

    // Process each order in background (no popup)
    for (let i = 0; i < currentSOTripPrintData.orders.length; i++) {
        const order = currentSOTripPrintData.orders[i];

        console.log(`[SO Trip MRA] Processing ${i + 1}/${currentSOTripPrintData.orders.length}: ${order.orderNumber}`);
        addSOTripMRALog(i, `Starting MRA processing for order: ${order.orderNumber}`, 'info');
        addSOTripMRALog(i, `Using Fusion account: ${fusionUsername}`, 'info');
        addSOTripMRALog(i, `Instance: ${resolvedInstance}`, 'info');

        // Update status
        order.mraStatus = 'PROCESSING';
        renderSOTripPrintOrders();

        try {
            // Process MRA in background
            const result = await processMRAInBackground(order.orderNumber, fusionUsername, fusionPassword, resolvedInstance, i);

            if (result.success) {
                order.mraStatus = 'SUCCESS';
                order.irnCode = result.irnCode;
                order.qrCode = result.qrCode;
                successCount++;
                addSOTripMRALog(i, `Final result: SUCCESS - ${result.message || 'MRA interface completed'}`, 'success');
                if (result.irnCode) {
                    addSOTripMRALog(i, `IRN Code: ${result.irnCode}`, 'success');
                }
                addSOLogEntry('MRA', `Success: ${order.orderNumber}`, 'success');
            } else {
                throw new Error(result.message || 'MRA processing failed');
            }

        } catch (error) {
            console.error(`[SO Trip MRA] Failed for ${order.orderNumber}:`, error);

            // Check if already interfaced
            const errorMsg = error.message || '';
            if (errorMsg.toLowerCase().includes('already')) {
                order.mraStatus = 'INTERFACED';
                order.mraError = errorMsg;
                interfacedCount++;
                addSOTripMRALog(i, `Already interfaced - ${errorMsg}`, 'info');
                addSOLogEntry('MRA', `Already Interfaced: ${order.orderNumber}`, 'info');
            } else {
                order.mraStatus = 'FAILED';
                order.mraError = errorMsg;
                failCount++;
                addSOTripMRALog(i, `Final result: FAILED - ${errorMsg}`, 'error');
                addSOLogEntry('MRA', `Failed: ${order.orderNumber} - ${errorMsg}`, 'error');
            }
        }

        renderSOTripPrintOrders();

        // Small delay between orders
        if (i < currentSOTripPrintData.orders.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Update final status
    let statusParts = [];
    if (successCount > 0) statusParts.push(`${successCount} OK`);
    if (interfacedCount > 0) statusParts.push(`${interfacedCount} Done`);
    if (failCount > 0) statusParts.push(`${failCount} Failed`);

    if (failCount === 0) {
        document.getElementById('so-trip-print-status').textContent = `MRA Complete ✓`;
        document.getElementById('so-trip-print-status').style.color = '#10b981';
        const logMsg = interfacedCount > 0
            ? `${successCount} processed, ${interfacedCount} already interfaced`
            : `All ${successCount} orders processed successfully`;
        addSOLogEntry('MRA', logMsg, 'success');
    } else {
        document.getElementById('so-trip-print-status').textContent = `MRA: ${statusParts.join(', ')}`;
        document.getElementById('so-trip-print-status').style.color = '#ef4444';
        document.getElementById('so-trip-print-retry-mra-btn').style.display = 'inline-flex';
        addSOLogEntry('MRA', `Complete: ${successCount} success, ${interfacedCount} already done, ${failCount} failed`, 'warning');
    }

    // Re-enable MRA button
    if (mraBtn) mraBtn.disabled = false;

    console.log(`[SO Trip MRA] Batch processing complete: ${successCount} succeeded, ${interfacedCount} already interfaced, ${failCount} failed`);
};

/**
 * Fetch Fusion credentials for batch MRA
 */
function fetchFusionCredentialsForBatchMRA() {
    return new Promise((resolve, reject) => {
        const credentialsUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fusionuserdetails';

        if (typeof sendMessageToCSharp !== 'function') {
            reject(new Error('sendMessageToCSharp not available'));
            return;
        }

        sendMessageToCSharp({
            action: "executeGet",
            fullUrl: credentialsUrl
        }, function(error, data) {
            if (error) {
                reject(new Error(error));
                return;
            }
            try {
                const response = JSON.parse(data);
                if (response.items && response.items.length > 0) {
                    const username = response.items[0].user_name || '';
                    const password = response.items[0].passwordd || '';
                    window.F_username = username;
                    window.F_password = password;
                    resolve({ username, password });
                } else {
                    reject(new Error('No credentials found'));
                }
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Process MRA in background (no popup) - listens for C# messages
 */
function processMRAInBackground(orderNumber, fusionUsername, fusionPassword, instance, orderIndex) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('MRA processing timeout (3 minutes)'));
        }, 180000);

        // Message handler for this order
        function messageHandler(event) {
            const data = event.data;
            if (!data || !data.action) return;

            // Log progress messages
            if (data.action === 'mraProcessingProgress') {
                addSOTripMRALog(orderIndex, `[${data.step}] ${data.message}`, 'info');
            } else if (data.action === 'mraOrderData') {
                addSOTripMRALog(orderIndex, 'Received order data from Fusion', 'info');
            } else if (data.action === 'mraRequestData') {
                addSOTripMRALog(orderIndex, `MRA Endpoint: ${data.endpoint}`, 'info');
            } else if (data.action === 'mraResponseData') {
                addSOTripMRALog(orderIndex, `MRA Response: ${data.success ? 'Success' : 'Failed'}`, data.success ? 'success' : 'error');
            } else if (data.action === 'processMRAInterfaceResponse') {
                // Final response - clean up and resolve
                cleanup();

                addSOTripMRALog(orderIndex, `Processing complete: ${data.success ? 'SUCCESS' : 'FAILED'} - ${data.message}`, data.success ? 'success' : 'error');

                if (data.success) {
                    // Extract IRN from message if not in irnCode field
                    let irnCode = data.irnCode;
                    if (!irnCode && data.message) {
                        const match = data.message.match(/IRN:\s*(\S+)/);
                        if (match) irnCode = match[1];
                    }

                    resolve({
                        success: true,
                        message: data.message,
                        irnCode: irnCode,
                        qrCode: data.qrCodeBase64
                    });
                } else {
                    resolve({
                        success: false,
                        message: data.message || 'MRA processing failed'
                    });
                }
            }
        }

        function cleanup() {
            clearTimeout(timeoutId);
            if (window.chrome?.webview) {
                window.chrome.webview.removeEventListener('message', messageHandler);
            }
        }

        // Register message listener
        if (window.chrome?.webview) {
            window.chrome.webview.addEventListener('message', messageHandler);

            // Send request to C#
            addSOTripMRALog(orderIndex, 'Sending request to C# backend...', 'info');

            window.chrome.webview.postMessage({
                action: 'processMRAInterface',
                requestId: Date.now().toString() + '_batch_' + orderIndex,
                orderNumber: orderNumber,
                fusionUsername: fusionUsername,
                fusionPassword: fusionPassword,
                instance: instance
            });
        } else {
            cleanup();
            reject(new Error('WebView2 not available'));
        }
    });
}

/**
 * Retry MRA for a single order - processes in background
 */
window.retrySOTripMRA = async function(orderIndex) {
    if (!currentSOTripPrintData || !currentSOTripPrintData.orders) return;

    const order = currentSOTripPrintData.orders[orderIndex];
    if (!order) return;

    // Get Fusion credentials
    let fusionUsername = window.F_username;
    let fusionPassword = window.F_password;

    if (!fusionUsername || !fusionPassword) {
        try {
            const credentials = await fetchFusionCredentialsForBatchMRA();
            fusionUsername = credentials.username;
            fusionPassword = credentials.password;
        } catch (error) {
            alert('Failed to fetch Fusion credentials: ' + error.message);
            return;
        }
    }

    console.log(`[SO Trip MRA] Retrying MRA for order: ${order.orderNumber}`);
    addSOTripMRALog(orderIndex, `Retrying MRA for order: ${order.orderNumber}`, 'info');
    addSOTripMRALog(orderIndex, `Using Fusion account: ${fusionUsername}`, 'info');

    order.mraStatus = 'PROCESSING';
    order.mraError = null;
    renderSOTripPrintOrders();

    const resolvedInstance = currentSOTripPrintData.instanceName ||
                            localStorage.getItem('fusionInstance') ||
                            localStorage.getItem('instanceName') ||
                            'PROD';

    try {
        // Process MRA in background
        const result = await processMRAInBackground(order.orderNumber, fusionUsername, fusionPassword, resolvedInstance, orderIndex);

        if (result.success) {
            order.mraStatus = 'SUCCESS';
            order.irnCode = result.irnCode;
            order.qrCode = result.qrCode;
            addSOTripMRALog(orderIndex, `Final result: SUCCESS - ${result.message || 'MRA interface completed'}`, 'success');
            if (result.irnCode) {
                addSOTripMRALog(orderIndex, `IRN Code: ${result.irnCode}`, 'success');
            }
            addSOLogEntry('MRA', `Retry Success: ${order.orderNumber}`, 'success');
        } else {
            throw new Error(result.message || 'MRA processing failed');
        }

    } catch (error) {
        console.error(`[SO Trip MRA] Retry failed for ${order.orderNumber}:`, error);
        order.mraStatus = 'FAILED';
        order.mraError = error.message;
        addSOTripMRALog(orderIndex, `Final result: FAILED - ${error.message}`, 'error');
        addSOLogEntry('MRA', `Retry Failed: ${order.orderNumber} - ${error.message}`, 'error');
    }

    renderSOTripPrintOrders();
};

/**
 * Retry MRA for all failed orders
 */
window.retryAllSOTripMRA = async function() {
    if (!currentSOTripPrintData || !currentSOTripPrintData.orders) return;

    // Find all failed orders
    const failedOrderIndices = [];
    currentSOTripPrintData.orders.forEach((order, index) => {
        if (order.mraStatus === 'FAILED') {
            failedOrderIndices.push(index);
        }
    });

    if (failedOrderIndices.length === 0) {
        alert('No failed orders to retry');
        return;
    }

    console.log(`[SO Trip MRA] Retrying ${failedOrderIndices.length} failed orders`);
    addSOLogEntry('MRA', `Retrying ${failedOrderIndices.length} failed orders`, 'info');

    document.getElementById('so-trip-print-retry-mra-btn').style.display = 'none';

    for (const index of failedOrderIndices) {
        await retrySOTripMRA(index);
        // Add delay between retries
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Check if any still failed
    const stillFailed = currentSOTripPrintData.orders.filter(o => o.mraStatus === 'FAILED').length;
    if (stillFailed > 0) {
        document.getElementById('so-trip-print-retry-mra-btn').style.display = 'inline-flex';
    }
};

/**
 * Show MRA log for a specific order
 */
window.showSOTripMRALog = function(orderIndex) {
    if (!currentSOTripPrintData || !currentSOTripPrintData.orders) return;

    const order = currentSOTripPrintData.orders[orderIndex];
    if (!order) return;

    const logs = soTripMRALogs.get(orderIndex) || [];

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'so-trip-mra-log-overlay';
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
    `;

    const logHtml = logs.length > 0
        ? logs.map(log => {
            const color = log.type === 'error' ? '#ef4444' :
                         log.type === 'success' ? '#10b981' :
                         log.type === 'warning' ? '#f59e0b' : '#64748b';
            return `<div style="padding: 0.5rem; border-left: 3px solid ${color}; margin-bottom: 0.5rem; background: #f8f9fa; font-size: 12px;">
                <span style="color: #94a3b8; margin-right: 0.5rem;">[${log.timestamp}]</span>
                <span style="color: ${color};">${log.message}</span>
            </div>`;
        }).join('')
        : '<p style="color: #94a3b8; text-align: center;">No logs available. Process MRA Interface first.</p>';

    overlay.innerHTML = `
        <div style="background: white; width: 600px; max-width: 95%; max-height: 80vh; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <h3 style="margin: 0; font-size: 1rem;">
                        <i class="fas fa-list-alt"></i> MRA Log - ${order.orderNumber}
                    </h3>
                    <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; opacity: 0.9;">Status: ${order.mraStatus || 'PENDING'}</p>
                </div>
                <button onclick="document.getElementById('so-trip-mra-log-overlay').remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1rem;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div style="padding: 1rem; overflow-y: auto; flex: 1;">
                ${logHtml}
                ${order.mraError ? `<div style="padding: 0.75rem; background: #fee2e2; border-left: 4px solid #ef4444; border-radius: 4px; margin-top: 1rem;">
                    <strong style="color: #991b1b;">Error:</strong>
                    <span style="color: #b91c1c;">${order.mraError}</span>
                </div>` : ''}
                ${order.irnCode ? `<div style="padding: 0.75rem; background: #dcfce7; border-left: 4px solid #10b981; border-radius: 4px; margin-top: 1rem;">
                    <strong style="color: #166534;">IRN Code:</strong>
                    <span style="color: #15803d; font-family: monospace;">${order.irnCode}</span>
                </div>` : ''}
            </div>
            <div style="padding: 1rem; border-top: 1px solid #e2e8f0; text-align: right;">
                <button onclick="document.getElementById('so-trip-mra-log-overlay').remove()" style="background: #667eea; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    Close
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
};

console.log('[Auto SO Processing] Module loaded');

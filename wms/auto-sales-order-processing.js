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
                    <div style="display: flex; gap: 1.5rem; align-items: center; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <i class="fas fa-truck so-trip-group-icon" style="color: #667eea; font-size: 16px;"></i>
                            <div>
                                <div class="so-trip-group-label" style="font-size: 8px; color: #64748b; font-weight: 600;">TRIP ID</div>
                                <div class="so-trip-group-value" style="font-size: 13px; font-weight: 700; color: #1e293b;">${trip.trip_id}</div>
                            </div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 8px; color: #64748b; font-weight: 600;">DATE</div>
                            <div class="so-trip-group-value-sm" style="font-size: 11px; font-weight: 600; color: #1e293b;">${trip.trip_date ? new Date(trip.trip_date).toLocaleDateString() : 'N/A'}</div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 8px; color: #64748b; font-weight: 600;">ORDERS</div>
                            <div class="so-trip-group-value" style="font-size: 13px; font-weight: 700; color: #667eea;">${orderCount}</div>
                        </div>
                        <div>
                            <div class="so-trip-group-label" style="font-size: 8px; color: #64748b; font-weight: 600;">LINES</div>
                            <div class="so-trip-group-value" style="font-size: 13px; font-weight: 700; color: #667eea;">${trip.transactions.length}</div>
                        </div>
                        <div class="so-trip-stats-badges" style="display: flex; gap: 0.4rem;">
                            ${successCount > 0 ? `<span class="so-trip-stats-badge" style="background: #10b981; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;">${successCount} ✓</span>` : ''}
                            ${processingCount > 0 ? `<span class="so-trip-stats-badge" style="background: #f59e0b; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;"><i class="fas fa-spinner fa-spin"></i> ${processingCount}</span>` : ''}
                            ${pendingCount > 0 ? `<span class="so-trip-stats-badge" style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;">${pendingCount} ⏳</span>` : ''}
                            ${cancelledCount > 0 ? `<span class="so-trip-stats-badge" style="background: #6b7280; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;">${cancelledCount} ⊘</span>` : ''}
                            ${failedCount > 0 ? `<span class="so-trip-stats-badge" style="background: #ef4444; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;">${failedCount} ✗</span>` : ''}
                        </div>
                    </div>
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
        <div style="display: flex; justify-content: flex-end; margin-bottom: 1rem; gap: 0.5rem;">
            <button onclick="expandAllSOOrders(${tripIndex})" style="background: #667eea; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;">
                <i class="fas fa-expand-alt"></i> Expand All
            </button>
            <button onclick="collapseAllSOOrders(${tripIndex})" style="background: #94a3b8; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;">
                <i class="fas fa-compress-alt"></i> Collapse All
            </button>
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

        const orderId = `so-trip-${tripIndex}-order-${orderIdx}`;

        html += `
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;" data-so-order-container="${tripIndex}">
                <!-- Order Header -->
                <div class="so-order-group-header" onclick="toggleSOOrderDetails('${orderId}')" style="padding: 0.5rem 0.75rem; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s; border-left: 3px solid #667eea;" onmouseover="this.style.background='linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'" onmouseout="this.style.background='linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)'">
                    <div style="display: flex; gap: 1rem; align-items: center; flex: 1;">
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
                            <span class="so-order-stats-badge" style="display: inline-flex; align-items: center; gap: 0.2rem; background: ${statusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
                                <i class="fas fa-${statusIcon}"></i> ${orderStatus}
                            </span>
                        </div>
                        <div style="display: flex; gap: 0.4rem; margin-left: auto;">
                            <button onclick="event.stopPropagation(); processSOSingleOrder('${order.source_order}', ${tripIndex})" style="background: #667eea; color: white; border: none; padding: 0.3rem 0.6rem; border-radius: 5px; cursor: pointer; font-size: 9px; font-weight: 600; display: flex; align-items: center; gap: 0.2rem; transition: all 0.2s;" onmouseover="this.style.background='#5568d3'" onmouseout="this.style.background='#667eea'">
                                <i class="fas fa-play"></i> Process
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
                    <td style="padding: 0.6rem 0.75rem; text-align: center;">
                        <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${pickConfirmColor}; color: white; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: 700;">
                            ${item.pick_confirm_st || 'NO'}
                        </span>
                    </td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center;" id="so-status-cell-${tripIndex}-${item.originalIndex}">
                        <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${itemStatusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
                            <i class="fas fa-${itemStatusIcon}"></i> ${itemStatus}
                        </span>
                    </td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center;" id="so-action-cell-${tripIndex}-${item.originalIndex}">
                        ${itemStatus === 'FAILED' ? `
                            <div style="display: flex; gap: 0.25rem; justify-content: center;">
                                <button onclick="processSOSingleLine(${tripIndex}, ${item.originalIndex})" style="background: #10b981; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
                                    <i class="fas fa-redo"></i> Retry
                                </button>
                            </div>
                        ` : itemStatus === 'PROCESSING' ? `
                            <span style="color: #f59e0b; font-size: 10px;"><i class="fas fa-spinner fa-spin"></i> Processing...</span>
                        ` : itemStatus === 'SUCCESS' ? `
                            <span style="color: #10b981; font-size: 10px;"><i class="fas fa-check-circle"></i> Done</span>
                        ` : itemStatus === 'CANCELLED' ? `
                            <span style="color: #6b7280; font-size: 10px;"><i class="fas fa-ban"></i> Cancelled</span>
                        ` : `
                            <button onclick="processSOSingleLine(${tripIndex}, ${item.originalIndex})" style="background: #10b981; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
                                <i class="fas fa-play"></i> Process
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
                <button onclick="processSOSingleLine(${tripIndex}, ${transactionIndex})" style="background: #10b981; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
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
            <button onclick="processSOSingleLine(${tripIndex}, ${transactionIndex})" style="background: #10b981; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
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

console.log('[Auto SO Processing] Module loaded');

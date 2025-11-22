// ============================================================================
// AUTO INVENTORY PROCESSING
// ============================================================================
//  Automated inventory transaction processing with intelligent retry
// ============================================================================

// Global state
let autoProcessingEnabled = false;
let autoProcessingInterval = null;
let autoProcessingData = [];
let autoProcessingFilters = {
    itemDesc: '',
    lid: '',
    trxNumber: '',
    status: ''
};
let autoProcessingStats = {
    totalTrips: 0,
    totalOrders: 0,
    processing: 0,
    success: 0,
    failed: 0
};

// Oracle Fusion Cloud credentials
let fusionCloudUsername = '';
let fusionCloudPassword = '';

// Initialize auto processing on page load
document.addEventListener('DOMContentLoaded', function() {
    initializeAutoProcessing();
    fetchFusionCloudCredentials();
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

// Fetch Oracle Fusion Cloud credentials
function fetchFusionCloudCredentials() {
    const credentialsUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fusionuserdetails';

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

                console.log('[Auto Processing] Fusion Cloud credentials loaded:', fusionCloudUsername);
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
    const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/transactionforautopr?P_FROM_DATE=${fromDate}&P_TO_DATE=${toDate}`;

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
                addLogEntry('API', `Fetched ${autoProcessingData.length} transaction records`, 'success');

                // Group and display data
                displayGroupedTrips();

                // Update statistics
                updateStatistics();

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

    return Object.values(grouped);
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

        // Calculate status counts
        const successCount = trip.transactions.filter(t => t.transaction_status === 'SUCCESS').length;
        const failedCount = trip.transactions.filter(t => t.transaction_status === 'FAILED' || t.transaction_status === 'ERROR').length;
        const processingCount = trip.transactions.filter(t => t.transaction_status === 'PROCESSING').length;
        const pendingCount = trip.transactions.length - successCount - failedCount - processingCount;

        html += `
            <div style="background: white; border: 2px solid #e2e8f0; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; transition: all 0.3s;">
                <!-- Trip Header -->
                <div onclick="toggleTripDetails(${index})" style="padding: 1rem 1.5rem; background: linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s;" onmouseover="this.style.background='linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)'" onmouseout="this.style.background='linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%)'">
                    <div style="display: flex; gap: 2rem; align-items: center; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fas fa-truck" style="color: #667eea; font-size: 20px;"></i>
                            <div>
                                <div style="font-size: 10px; color: #64748b; font-weight: 600;">TRIP ID</div>
                                <div style="font-size: 16px; font-weight: 700; color: #1e293b;">${trip.trip_id}</div>
                            </div>
                        </div>
                        <div>
                            <div style="font-size: 10px; color: #64748b; font-weight: 600;">DATE</div>
                            <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${new Date(trip.trip_date).toLocaleDateString()}</div>
                        </div>
                        <div>
                            <div style="font-size: 10px; color: #64748b; font-weight: 600;">LORRY</div>
                            <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${trip.trip_lorry}</div>
                        </div>
                        <div>
                            <div style="font-size: 10px; color: #64748b; font-weight: 600;">PRIORITY</div>
                            <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${trip.trip_priority}</div>
                        </div>
                        <div>
                            <div style="font-size: 10px; color: #64748b; font-weight: 600;">LOADING BAY</div>
                            <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${trip.trip_loading_bay || 'N/A'}</div>
                        </div>
                        <div>
                            <div style="font-size: 10px; color: #64748b; font-weight: 600;">ORDERS</div>
                            <div style="font-size: 16px; font-weight: 700; color: #667eea;">${orderCount}</div>
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            ${successCount > 0 ? `<span style="background: #10b981; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">${successCount} ✓</span>` : ''}
                            ${processingCount > 0 ? `<span style="background: #f59e0b; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;"><i class="fas fa-spinner fa-spin"></i> ${processingCount}</span>` : ''}
                            ${pendingCount > 0 ? `<span style="background: #3b82f6; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">${pendingCount} ⏳</span>` : ''}
                            ${failedCount > 0 ? `<span style="background: #ef4444; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">${failedCount} ✗</span>` : ''}
                        </div>
                    </div>
                    <i class="fas fa-chevron-down" id="trip-chevron-${index}" style="color: #667eea; transition: transform 0.3s;"></i>
                </div>

                <!-- Trip Details (Collapsible) -->
                <div id="trip-details-${index}" style="display: none; padding: 1.5rem; background: #f8f9fa;">
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
        if (!orderGroups[orderNum]) {
            orderGroups[orderNum] = {
                trx_number: orderNum,
                trx_type: trx.trx_type,
                source_sub_inv: trx.source_sub_inv,
                dest_sub_inv: trx.dest_sub_inv,
                items: [],
                totalQty: 0,
                totalLines: 0,
                processedLines: 0,
                notProcessedLines: 0,
                overallStatus: trx.transaction_status
            };
        }
        orderGroups[orderNum].items.push({ ...trx, originalIndex: idx });
        orderGroups[orderNum].totalQty += trx.picked_qty || 0;
        orderGroups[orderNum].totalLines += 1;

        // Count processed vs not processed
        if (trx.transaction_status === 'SUCCESS') {
            orderGroups[orderNum].processedLines += 1;
        } else {
            orderGroups[orderNum].notProcessedLines += 1;
        }
    });

    const orders = Object.values(orderGroups);

    let html = `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 1rem; gap: 0.5rem;">
            <button onclick="expandAllOrders(${tripIndex})" style="background: #667eea; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;">
                <i class="fas fa-expand-alt"></i> Expand All
            </button>
            <button onclick="collapseAllOrders(${tripIndex})" style="background: #94a3b8; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;">
                <i class="fas fa-compress-alt"></i> Collapse All
            </button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 1rem;">
    `;

    orders.forEach((order, orderIdx) => {
        const orderStatus = order.items.every(i => i.transaction_status === 'SUCCESS') ? 'SUCCESS' :
                           order.items.some(i => i.transaction_status === 'FAILED' || i.transaction_status === 'ERROR') ? 'FAILED' :
                           'PENDING';

        const statusColor = orderStatus === 'SUCCESS' ? '#10b981' :
                           orderStatus === 'FAILED' ? '#ef4444' :
                           '#3b82f6';

        const statusIcon = orderStatus === 'SUCCESS' ? 'check-circle' :
                          orderStatus === 'FAILED' ? 'times-circle' :
                          'clock';

        const orderId = `trip-${tripIndex}-order-${orderIdx}`;

        html += `
            <div style="background: white; border: 2px solid #e2e8f0; border-radius: 8px; overflow: hidden;" data-order-container="${tripIndex}">
                <!-- Order Header -->
                <div onclick="toggleOrderDetails('${orderId}')" style="padding: 0.75rem 1rem; background: linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s;" onmouseover="this.style.background='linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)'" onmouseout="this.style.background='linear-gradient(135deg, #f8f9fa 0%, #e2e8f0 100%)'">
                    <div style="display: flex; gap: 1.25rem; align-items: center; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fas fa-box" style="color: #667eea; font-size: 16px;"></i>
                            <div>
                                <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase;">Order</div>
                                <div style="font-size: 14px; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 0.5rem;">
                                    ${order.trx_number}
                                    <i class="fas fa-spinner fa-spin" id="order-processing-${orderId}" style="color: #667eea; font-size: 12px; display: none;"></i>
                                </div>
                            </div>
                        </div>
                        <div>
                            <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase;">Type</div>
                            <div style="font-size: 11px; font-weight: 600; color: #475569;">${order.trx_type || 'N/A'}</div>
                        </div>
                        <div>
                            <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase;">Total Lines</div>
                            <div style="font-size: 13px; font-weight: 700; color: #1e293b;">${order.totalLines}</div>
                        </div>
                        <div>
                            <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase;">Processed</div>
                            <div style="font-size: 13px; font-weight: 700; color: #10b981;">${order.processedLines}</div>
                        </div>
                        <div>
                            <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase;">Not Processed</div>
                            <div style="font-size: 13px; font-weight: 700; color: ${order.notProcessedLines > 0 ? '#ef4444' : '#cbd5e1'};">${order.notProcessedLines}</div>
                        </div>
                        <div>
                            <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase;">Total Qty</div>
                            <div style="font-size: 13px; font-weight: 700; color: #667eea;">${order.totalQty}</div>
                        </div>
                        <div>
                            <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase;">From → To</div>
                            <div style="font-size: 11px; font-weight: 600; color: #475569;">${order.source_sub_inv} → ${order.dest_sub_inv}</div>
                        </div>
                        <div>
                            <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${statusColor}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700;">
                                <i class="fas fa-${statusIcon}"></i> ${orderStatus}
                            </span>
                        </div>
                        <div style="display: flex; gap: 0.5rem; margin-left: auto;">
                            <button onclick="event.stopPropagation(); processSingleOrder('${order.trx_number}', ${tripIndex})" style="background: #667eea; color: white; border: none; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 0.25rem; transition: all 0.2s;" onmouseover="this.style.background='#5568d3'" onmouseout="this.style.background='#667eea'">
                                <i class="fas fa-play"></i> Process
                            </button>
                            <button onclick="event.stopPropagation(); verifyWithFusion('${order.trx_number}', ${tripIndex})" style="background: #3b82f6; color: white; border: none; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 0.25rem; transition: all 0.2s;" onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
                                <i class="fas fa-cloud-upload-alt"></i> Verify with Fusion
                            </button>
                            <button onclick="event.stopPropagation(); printOrder('${order.trx_number}', ${tripIndex})" style="background: #10b981; color: white; border: none; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 0.25rem; transition: all 0.2s;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
                                <i class="fas fa-print"></i> Print
                            </button>
                        </div>
                    </div>
                    <i class="fas fa-chevron-down" id="order-chevron-${orderId}" style="color: #667eea; transition: transform 0.3s; font-size: 12px;"></i>
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
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Qty</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Lot Number</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Status</th>
                                    <th style="padding: 0.5rem 0.75rem; text-align: center; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Action</th>
                                </tr>
                            </thead>
                            <tbody>
        `;

        order.items.forEach((item, itemIdx) => {
            const itemStatusColor = item.transaction_status === 'SUCCESS' ? '#10b981' :
                                   item.transaction_status === 'FAILED' || item.transaction_status === 'ERROR' ? '#ef4444' :
                                   item.transaction_status === 'PROCESSING' ? '#f59e0b' :
                                   '#3b82f6';

            const itemStatusIcon = item.transaction_status === 'SUCCESS' ? 'check-circle' :
                                  item.transaction_status === 'FAILED' || item.transaction_status === 'ERROR' ? 'times-circle' :
                                  item.transaction_status === 'PROCESSING' ? 'spinner fa-spin' :
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
                    <td style="padding: 0.6rem 0.75rem; text-align: center; font-size: 12px; font-weight: 700; color: #1e293b;">${item.picked_qty}</td>
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #475569;">${item.lot_number || 'N/A'}</td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center;" id="status-cell-${tripIndex}-${item.originalIndex}">
                        <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${itemStatusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 9px; font-weight: 700;">
                            <i class="fas fa-${itemStatusIcon}"></i> ${item.transaction_status || 'PENDING'}
                        </span>
                    </td>
                    <td style="padding: 0.6rem 0.75rem; text-align: center;" id="action-cell-${tripIndex}-${item.originalIndex}">
                        ${(item.transaction_status === 'FAILED' || item.transaction_status === 'ERROR') ? `
                            <div style="display: flex; gap: 0.25rem; justify-content: center;">
                                <button onclick="retryTransaction(${tripIndex}, ${item.originalIndex})" style="background: #f59e0b; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d97706'" onmouseout="this.style.background='#f59e0b'">
                                    <i class="fas fa-redo"></i> Retry
                                </button>
                                <button onclick="showErrorDetails(${tripIndex}, ${item.originalIndex})" style="background: #ef4444; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'">
                                    <i class="fas fa-exclamation-circle"></i> Show Errors
                                </button>
                            </div>
                        ` : item.transaction_status === 'PROCESSING' ? `
                            <span style="color: #f59e0b; font-size: 10px;"><i class="fas fa-spinner fa-spin"></i> Processing...</span>
                        ` : `
                            <span style="color: #cbd5e1; font-size: 10px;">-</span>
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
    autoProcessingStats.totalOrders = autoProcessingData.length;
    autoProcessingStats.success = autoProcessingData.filter(t => t.transaction_status === 'SUCCESS').length;
    autoProcessingStats.failed = autoProcessingData.filter(t => t.transaction_status === 'FAILED' || t.transaction_status === 'ERROR').length;
    autoProcessingStats.processing = autoProcessingData.filter(t => t.transaction_status === 'PROCESSING').length;

    // Update UI
    document.getElementById('auto-stat-trips').textContent = autoProcessingStats.totalTrips;
    document.getElementById('auto-stat-orders').textContent = autoProcessingStats.totalOrders;
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
function runSimulation() {
    if (!autoProcessingEnabled) {
        alert('Please enable Auto Processing first');
        return;
    }

    if (autoProcessingData.length === 0) {
        alert('Please fetch data first');
        return;
    }

    addLogEntry('System', 'Starting simulation - Processing all pending transactions...', 'info');

    // Start sequential processing
    processNextBatch();
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
                       '#3b82f6';

    const statusIcon = status === 'SUCCESS' ? 'check-circle' :
                      status === 'FAILED' || status === 'ERROR' ? 'times-circle' :
                      status === 'PROCESSING' ? 'spinner fa-spin' :
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
                <button onclick="retryTransaction(${tripIndex}, ${transactionIndex})" style="background: #f59e0b; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d97706'" onmouseout="this.style.background='#f59e0b'">
                    <i class="fas fa-redo"></i> Retry
                </button>
                <button onclick="showErrorDetails(${tripIndex}, ${transactionIndex})" style="background: #ef4444; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'">
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

    // Find pending transactions (case-insensitive check) and not bypassed
    const pendingTransactions = autoProcessingData.filter(t => {
        const status = (t.transaction_status || '').toUpperCase();
        const isPending = !t.transaction_status || status === '' || status === 'PENDING';
        const isNotBypassed = !t.bypassed; // Skip bypassed transactions
        return isPending && isNotBypassed;
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
    let stoppedDueToFailure = false;
    let processedOrders = 0;

    try {
        for (let orderIdx = 0; orderIdx < orderNumbers.length; orderIdx++) {
            const orderNumber = orderNumbers[orderIdx];
            const orderTransactions = transactionsByOrder[orderNumber];

            if (!autoProcessingEnabled) {
                addLogEntry('Processing', 'Auto processing was disabled. Stopping...', 'warning');
                break;
            }

            addLogEntry('Order', `Processing Order: ${orderNumber} (${orderTransactions.length} lines)`, 'info');

            // Show processing spinner for this order
            showOrderProcessingSpinner(orderNumber, true);

            // Process all lines in this order
            for (let i = 0; i < orderTransactions.length; i++) {
                const transaction = orderTransactions[i];

                if (!autoProcessingEnabled) {
                    addLogEntry('Processing', 'Auto processing was disabled. Stopping...', 'warning');
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

                try {
                    // Process transaction and update status in DOM
                    await processAutoTransaction(transaction, actualTripIndex, actualTransactionIndex);
                    processedCount++;

                    // Update statistics every 5 transactions
                    if (processedCount % 5 === 0 || (orderIdx === orderNumbers.length - 1 && i === orderTransactions.length - 1)) {
                        addLogEntry('Progress', `Processed ${processedCount} of ${pendingTransactions.length} transactions (${processedOrders + 1} of ${orderNumbers.length} orders)`, 'info');
                        updateStatistics();
                    }
                } catch (error) {
                    // Transaction failed - stop processing
                    stoppedDueToFailure = true;
                    addLogEntry('Error', `Processing stopped due to failure in Order ${orderNumber}. Processed ${processedCount} of ${pendingTransactions.length} transactions (${processedOrders} complete orders) before stopping.`, 'error');
                    updateStatistics();
                    // Hide processing spinner for this order
                    showOrderProcessingSpinner(orderNumber, false);
                    break;
                }
            }

            // Hide processing spinner for this order
            showOrderProcessingSpinner(orderNumber, false);

            if (stoppedDueToFailure) {
                break; // Stop processing remaining orders
            }

            processedOrders++;
            addLogEntry('Order', `✓ Order ${orderNumber} completed (${orderTransactions.length} lines processed)`, 'success');
        }

        if (autoProcessingEnabled && !stoppedDueToFailure) {
            addLogEntry('Processing', `All ${processedOrders} orders (${processedCount} transactions) processed successfully!`, 'success');
            updateStatistics();
        }
    } catch (error) {
        addLogEntry('Error', `Unexpected batch processing error: ${error.message}`, 'error');
        console.error('[Auto Processing] Batch error:', error);
        updateStatistics();
    }
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
        transaction.transaction_status = 'FAILED';
        transaction.error_message = error.message;

        // Update DOM to show FAILED status
        if (tripIndex !== -1 && transactionIndex !== -1) {
            updateTransactionStatusInDOM(tripIndex, transactionIndex, 'FAILED');
        }

        addLogEntry('Error', `✗ LID: ${transaction.lid} | Order: ${transaction.trx_number} | Line: ${transaction.line_number} | Item: ${transaction.item_code} - FAILED: ${error.message}`, 'error');

        // Throw error to stop batch processing
        throw error;
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

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/processs2vauto/${lid}`;

        console.log('[Auto Processing] Calling API for LID:', lid, apiUrl);

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

// Apply filters
function applyFilters() {
    // Get filter values
    autoProcessingFilters.itemDesc = document.getElementById('filter-item-desc').value.toLowerCase();
    autoProcessingFilters.lid = document.getElementById('filter-lid').value.toLowerCase();
    autoProcessingFilters.trxNumber = document.getElementById('filter-trx-number').value.toLowerCase();
    autoProcessingFilters.status = document.getElementById('filter-status').value.toUpperCase();

    // Apply filters by hiding/showing rows
    const groupedTrips = groupTransactionsByTrip();

    groupedTrips.forEach((trip, tripIdx) => {
        trip.transactions.forEach((item, itemIdx) => {
            const row = document.getElementById(`transaction-row-${tripIdx}-${itemIdx}`);
            if (!row) return;

            let showRow = true;

            // Filter by item description
            if (autoProcessingFilters.itemDesc &&
                !item.item_desc.toLowerCase().includes(autoProcessingFilters.itemDesc)) {
                showRow = false;
            }

            // Filter by LID
            if (autoProcessingFilters.lid &&
                !String(item.lid || '').toLowerCase().includes(autoProcessingFilters.lid)) {
                showRow = false;
            }

            // Filter by transaction number
            if (autoProcessingFilters.trxNumber &&
                !String(item.trx_number || '').toLowerCase().includes(autoProcessingFilters.trxNumber)) {
                showRow = false;
            }

            // Filter by status
            if (autoProcessingFilters.status &&
                (item.transaction_status || 'PENDING').toUpperCase() !== autoProcessingFilters.status) {
                showRow = false;
            }

            row.style.display = showRow ? '' : 'none';
        });
    });

    addLogEntry('Filter', 'Filters applied', 'info');
}

// Clear all filters
function clearFilters() {
    document.getElementById('filter-item-desc').value = '';
    document.getElementById('filter-lid').value = '';
    document.getElementById('filter-trx-number').value = '';
    document.getElementById('filter-status').value = '';

    autoProcessingFilters = {
        itemDesc: '',
        lid: '',
        trxNumber: '',
        status: ''
    };

    // Show all rows
    const allRows = document.querySelectorAll('[id^="transaction-row-"]');
    allRows.forEach(row => {
        row.style.display = '';
    });

    addLogEntry('Filter', 'Filters cleared', 'info');
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

            if (response.success && response.base64Data) {
                console.log('[Verify Fusion] Base64 data length:', response.base64Data.length);
                addLogEntry('Verify', `Received Base64 data from Fusion (${response.base64Data.length} chars)`, 'info');

                // Decode Base64 to get the actual data
                const decodedData = atob(response.base64Data);
                console.log('[Verify Fusion] Decoded data length:', decodedData.length);
                console.log('[Verify Fusion] Decoded data preview:', decodedData.substring(0, 500));

                addLogEntry('Verify', `Decoded data (${decodedData.length} chars)`, 'info');

                // Parse the decoded data (could be XML, CSV, or JSON)
                const fusionData = parseFusionReportData(decodedData);
                console.log('[Verify Fusion] Parsed fusion data:', fusionData);
                console.log('[Verify Fusion] Fusion records count:', fusionData.length);

                addLogEntry('Verify', `Parsed ${fusionData.length} records from Fusion report`, 'info');

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

    closeVerifyLoadingPopup();

    // Match local transactions with Fusion data by LID
    const enhancedTransactions = localTransactions.map(localTxn => {
        const lid = String(localTxn.lid || '').trim();
        console.log('[Display Verify] Matching LID:', lid);

        // Find matching Fusion record
        const fusionMatch = fusionData.find(fusionRecord => {
            // Try different possible LID field names
            const fusionLid = String(fusionRecord.LID || fusionRecord.lid || fusionRecord.LOAD_REQUEST_NUMBER || '').trim();
            return fusionLid === lid;
        });

        if (fusionMatch) {
            console.log('[Display Verify] Match found for LID', lid, ':', fusionMatch);
        } else {
            console.log('[Display Verify] No match for LID', lid);
        }

        return {
            ...localTxn,
            fusionQty: fusionMatch ? (fusionMatch.TRANSACTION_QUANTITY || fusionMatch.transaction_quantity || fusionMatch.QUANTITY || '0') : '-',
            fusionStatus: fusionMatch ? 'Matched' : 'Not Found'
        };
    });

    // Build table HTML
    let tableRows = '';
    enhancedTransactions.forEach((txn, index) => {
        const statusColor = txn.fusionStatus === 'Matched' ? '#10b981' : '#ef4444';
        const qtyMatch = String(txn.txn_qty) === String(txn.fusionQty);
        const qtyColor = qtyMatch ? '#10b981' : '#f59e0b';

        tableRows += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 0.75rem; font-size: 12px; color: #94a3b8;">${index + 1}</td>
                <td style="padding: 0.75rem; font-size: 12px; font-weight: 600; color: #667eea;">${txn.lid || 'N/A'}</td>
                <td style="padding: 0.75rem; font-size: 12px; color: #1e293b;">${txn.item_code || 'N/A'}</td>
                <td style="padding: 0.75rem; font-size: 12px; color: #1e293b;">${txn.item_desc || 'N/A'}</td>
                <td style="padding: 0.75rem; font-size: 12px; text-align: center; font-weight: 600; color: #1e293b;">${txn.txn_qty || 0}</td>
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
        <div style="background: white; border-radius: 12px; padding: 0; min-width: 900px; max-width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
            <!-- Header -->
            <div style="padding: 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <h3 style="margin: 0; color: white; font-size: 18px; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-check-double"></i>
                    Fusion Verification - Order ${orderNumber}
                </h3>
                <p style="margin: 0.5rem 0 0 0; color: rgba(255,255,255,0.9); font-size: 13px;">
                    Matched: ${matchedCount} | Not Found: ${notFoundCount} | Total: ${enhancedTransactions.length}
                </p>
            </div>

            <!-- Content -->
            <div style="flex: 1; overflow-y: auto; padding: 1.5rem;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f8f9fa; border-bottom: 2px solid #e2e8f0;">
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">#</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">LID</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Item Code</th>
                            <th style="padding: 0.75rem; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Description</th>
                            <th style="padding: 0.75rem; text-align: center; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Local Qty</th>
                            <th style="padding: 0.75rem; text-align: center; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Fusion Qty</th>
                            <th style="padding: 0.75rem; text-align: center; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Fusion Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
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

    // Filter out bypassed transactions
    const pendingTransactions = orderTransactions.filter(t => {
        const status = (t.transaction_status || '').toUpperCase();
        const isPending = !t.transaction_status || status === '' || status === 'PENDING';
        const isNotBypassed = !t.bypassed;
        return isPending && isNotBypassed;
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

// Make functions globally accessible
window.fetchAutoInventoryData = fetchAutoInventoryData;
window.runSimulation = runSimulation;
window.toggleTripDetails = toggleTripDetails;
window.toggleOrderDetails = toggleOrderDetails;
window.expandAllOrders = expandAllOrders;
window.collapseAllOrders = collapseAllOrders;
window.retryTransaction = retryTransaction;
window.switchAutoTab = switchAutoTab;
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

console.log('[Auto Processing] Script loaded successfully');

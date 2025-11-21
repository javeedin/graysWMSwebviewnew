// ============================================================================
// AUTO INVENTORY PROCESSING
// ============================================================================
//  Automated inventory transaction processing with intelligent retry
// ============================================================================

// Global state
let autoProcessingEnabled = false;
let autoProcessingInterval = null;
let autoProcessingData = [];
let autoProcessingStats = {
    totalTrips: 0,
    totalOrders: 0,
    processing: 0,
    success: 0,
    failed: 0
};

// Initialize auto processing on page load
document.addEventListener('DOMContentLoaded', function() {
    initializeAutoProcessing();
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
                                <div style="font-size: 14px; font-weight: 700; color: #1e293b;">${order.trx_number}</div>
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
                    </div>
                    <i class="fas fa-chevron-down" id="order-chevron-${orderId}" style="color: #667eea; transition: transform 0.3s; font-size: 12px;"></i>
                </div>

                <!-- Order Items (Collapsible) -->
                <div id="order-details-${orderId}" style="display: none;">
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #f8f9fa; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">
                                    <th style="padding: 0.5rem 0.75rem; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">#</th>
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
                <tr id="transaction-row-${tripIndex}-${item.originalIndex}" style="border-bottom: 1px solid #f0f0f0;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='white'">
                    <td style="padding: 0.6rem 0.75rem; font-size: 11px; color: #94a3b8; font-weight: 600;">${itemIdx + 1}</td>
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
                            <button onclick="retryTransaction(${tripIndex}, ${item.originalIndex})" style="background: #f59e0b; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d97706'" onmouseout="this.style.background='#f59e0b'">
                                <i class="fas fa-redo"></i> Retry
                            </button>
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
            <button onclick="retryTransaction(${tripIndex}, ${transactionIndex})" style="background: #f59e0b; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d97706'" onmouseout="this.style.background='#f59e0b'">
                <i class="fas fa-redo"></i> Retry
            </button>
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

    // Find pending transactions (case-insensitive check)
    const pendingTransactions = autoProcessingData.filter(t => {
        const status = (t.transaction_status || '').toUpperCase();
        return !t.transaction_status || status === '' || status === 'PENDING';
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

    addLogEntry('Processing', `Found ${pendingTransactions.length} pending transactions. Starting background processing...`, 'info');

    // Process transactions one by one in background
    let processedCount = 0;
    try {
        for (let i = 0; i < pendingTransactions.length; i++) {
            const transaction = pendingTransactions[i];

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

            // Process transaction and update status in DOM
            await processAutoTransaction(transaction, actualTripIndex, actualTransactionIndex);
            processedCount++;

            // Update statistics every 5 transactions
            if (processedCount % 5 === 0 || i === pendingTransactions.length - 1) {
                addLogEntry('Progress', `Processed ${processedCount} of ${pendingTransactions.length} transactions`, 'info');
                updateStatistics();
            }
        }

        if (autoProcessingEnabled) {
            addLogEntry('Processing', `All ${processedCount} pending transactions processed!`, 'success');
            updateStatistics();
        }
    } catch (error) {
        addLogEntry('Error', `Batch processing error: ${error.message}`, 'error');
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
        // TODO: Call actual web service API to process transaction
        // For now, simulate processing
        await simulateProcessing(transaction);

        // Update transaction status
        transaction.transaction_status = 'SUCCESS';

        // Update DOM to show SUCCESS status
        if (tripIndex !== -1 && transactionIndex !== -1) {
            updateTransactionStatusInDOM(tripIndex, transactionIndex, 'SUCCESS');
        }

        addLogEntry('Success', `✓ Order: ${transaction.trx_number} | Line: ${transaction.line_number} | Item: ${transaction.item_code} - SUCCESS`, 'success');

    } catch (error) {
        console.error('[Auto Processing] Error processing transaction:', error);
        transaction.transaction_status = 'FAILED';
        transaction.error_message = error.message;

        // Update DOM to show FAILED status
        if (tripIndex !== -1 && transactionIndex !== -1) {
            updateTransactionStatusInDOM(tripIndex, transactionIndex, 'FAILED');
        }

        addLogEntry('Error', `✗ Order: ${transaction.trx_number} | Line: ${transaction.line_number} | Item: ${transaction.item_code} - FAILED: ${error.message}`, 'error');

        // Note: No auto-retry, user must use Retry button
    }
}

// Simulate processing (replace with actual API call)
function simulateProcessing(transaction) {
    return new Promise((resolve, reject) => {
        // Simulate processing time 0.2-0.8 seconds (fast for testing)
        const processingTime = 200 + Math.random() * 600;

        setTimeout(() => {
            // Simulate 90% success rate (10% failure for testing)
            const randomValue = Math.random();

            if (randomValue > 0.1) {
                resolve();
            } else {
                const errorMsg = `SIMULATED RANDOM FAILURE`;
                reject(new Error(errorMsg));
            }
        }, processingTime);
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

// Make functions globally accessible
window.fetchAutoInventoryData = fetchAutoInventoryData;
window.runSimulation = runSimulation;
window.toggleTripDetails = toggleTripDetails;
window.toggleOrderDetails = toggleOrderDetails;
window.expandAllOrders = expandAllOrders;
window.collapseAllOrders = collapseAllOrders;
window.retryTransaction = retryTransaction;
window.switchAutoTab = switchAutoTab;

console.log('[Auto Processing] Script loaded successfully');

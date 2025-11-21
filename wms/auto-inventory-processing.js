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

// Fetch auto inventory data from API
async function fetchAutoInventoryData() {
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

    try {
        // Get instance from sessionStorage or header
        const instance = sessionStorage.getItem('loggedInInstance')
            || document.getElementById('current-instance-display')?.textContent
            || 'PROD';

        // Build API URL
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/transactionforautopr?P_FROM_DATE=${fromDate}&P_TO_DATE=${toDate}`;

        console.log('[Auto Processing] Fetching from:', apiUrl);

        const response = await fetch(apiUrl);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Store the data
        autoProcessingData = data.items || [];

        console.log('[Auto Processing] Fetched', autoProcessingData.length, 'records');
        addLogEntry('API', `Fetched ${autoProcessingData.length} transaction records`, 'success');

        // Group and display data
        displayGroupedTrips();

        // Update statistics
        updateStatistics();

    } catch (error) {
        console.error('[Auto Processing] Fetch error:', error);
        addLogEntry('Error', `Failed to fetch data: ${error.message}`, 'error');
        alert('Failed to fetch data: ' + error.message);
    } finally {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Fetch Data';
    }
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
        const pendingCount = trip.transactions.length - successCount - failedCount;

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
}

// Render trip transactions table
function renderTripTransactions(transactions, tripIndex) {
    let html = `
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden;">
                <thead>
                    <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                        <th style="padding: 0.75rem; text-align: left; font-size: 12px; font-weight: 700;">#</th>
                        <th style="padding: 0.75rem; text-align: left; font-size: 12px; font-weight: 700;">TRX NUMBER</th>
                        <th style="padding: 0.75rem; text-align: left; font-size: 12px; font-weight: 700;">ITEM CODE</th>
                        <th style="padding: 0.75rem; text-align: left; font-size: 12px; font-weight: 700;">ITEM DESCRIPTION</th>
                        <th style="padding: 0.75rem; text-align: center; font-size: 12px; font-weight: 700;">PICKED QTY</th>
                        <th style="padding: 0.75rem; text-align: left; font-size: 12px; font-weight: 700;">SOURCE SUB INV</th>
                        <th style="padding: 0.75rem; text-align: left; font-size: 12px; font-weight: 700;">DEST SUB INV</th>
                        <th style="padding: 0.75rem; text-align: center; font-size: 12px; font-weight: 700;">STATUS</th>
                        <th style="padding: 0.75rem; text-align: center; font-size: 12px; font-weight: 700;">ACTION</th>
                    </tr>
                </thead>
                <tbody>
    `;

    transactions.forEach((trx, idx) => {
        const statusColor = trx.transaction_status === 'SUCCESS' ? '#10b981' :
                           trx.transaction_status === 'FAILED' || trx.transaction_status === 'ERROR' ? '#ef4444' :
                           '#3b82f6';

        const statusIcon = trx.transaction_status === 'SUCCESS' ? 'check-circle' :
                          trx.transaction_status === 'FAILED' || trx.transaction_status === 'ERROR' ? 'times-circle' :
                          'clock';

        html += `
            <tr style="border-bottom: 1px solid #e2e8f0;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='white'">
                <td style="padding: 0.75rem; font-size: 13px; color: #64748b; font-weight: 600;">${idx + 1}</td>
                <td style="padding: 0.75rem; font-size: 13px; font-weight: 600; color: #1e293b;">${trx.trx_number}</td>
                <td style="padding: 0.75rem; font-size: 12px; font-weight: 600; color: #667eea;">${trx.item_code}</td>
                <td style="padding: 0.75rem; font-size: 12px; color: #475569; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${trx.item_desc}">${trx.item_desc}</td>
                <td style="padding: 0.75rem; text-align: center; font-size: 14px; font-weight: 700; color: #1e293b;">${trx.picked_qty}</td>
                <td style="padding: 0.75rem; font-size: 12px; color: #475569;">${trx.source_sub_inv}</td>
                <td style="padding: 0.75rem; font-size: 12px; color: #475569;">${trx.dest_sub_inv}</td>
                <td style="padding: 0.75rem; text-align: center;">
                    <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: ${statusColor}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700;">
                        <i class="fas fa-${statusIcon}"></i> ${trx.transaction_status || 'PENDING'}
                    </span>
                </td>
                <td style="padding: 0.75rem; text-align: center;">
                    ${(trx.transaction_status === 'FAILED' || trx.transaction_status === 'ERROR') ? `
                        <button onclick="retryTransaction(${tripIndex}, ${idx})" style="background: #f59e0b; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='#d97706'" onmouseout="this.style.background='#f59e0b'">
                            <i class="fas fa-redo"></i> Retry
                        </button>
                    ` : `
                        <span style="color: #94a3b8; font-size: 11px;">-</span>
                    `}
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

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

// Update statistics
function updateStatistics() {
    const groupedTrips = groupTransactionsByTrip();

    // Calculate stats
    autoProcessingStats.totalTrips = groupedTrips.length;
    autoProcessingStats.totalOrders = autoProcessingData.length;
    autoProcessingStats.success = autoProcessingData.filter(t => t.transaction_status === 'SUCCESS').length;
    autoProcessingStats.failed = autoProcessingData.filter(t => t.transaction_status === 'FAILED' || t.transaction_status === 'ERROR').length;
    autoProcessingStats.processing = 0; // Will be updated during processing

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

    addLogEntry('System', 'Auto processing ENABLED', 'success');

    // Get refresh interval
    const intervalSeconds = parseInt(document.getElementById('auto-refresh-interval').value);

    // Start background processing
    processNextBatch();

    // Setup interval for automatic refresh and processing
    autoProcessingInterval = setInterval(() => {
        fetchAutoInventoryData().then(() => {
            processNextBatch();
        });
    }, intervalSeconds * 1000);
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

// Process next batch of transactions
async function processNextBatch() {
    if (!autoProcessingEnabled) return;

    // Find pending transactions
    const pendingTransactions = autoProcessingData.filter(t =>
        !t.transaction_status || t.transaction_status === 'PENDING' || t.transaction_status === ''
    );

    if (pendingTransactions.length === 0) {
        addLogEntry('Processing', 'No pending transactions found', 'info');
        return;
    }

    addLogEntry('Processing', `Found ${pendingTransactions.length} pending transactions. Starting processing...`, 'info');

    // Process first pending transaction
    await processTransaction(pendingTransactions[0]);
}

// Process a single transaction
async function processTransaction(transaction) {
    addLogEntry('Processing', `Processing transaction ${transaction.trx_number}...`, 'info');

    try {
        // TODO: Call actual web service API to process transaction
        // For now, simulate processing
        await simulateProcessing(transaction);

        // Update transaction status
        transaction.transaction_status = 'SUCCESS';

        addLogEntry('Success', `Transaction ${transaction.trx_number} processed successfully`, 'success');

        // Update display
        displayGroupedTrips();
        updateStatistics();

    } catch (error) {
        console.error('[Auto Processing] Error processing transaction:', error);
        transaction.transaction_status = 'FAILED';
        transaction.error_message = error.message;

        addLogEntry('Error', `Transaction ${transaction.trx_number} failed: ${error.message}`, 'error');

        // Update display
        displayGroupedTrips();
        updateStatistics();

        // Auto retry after 5 seconds
        setTimeout(() => {
            if (autoProcessingEnabled) {
                retryTransactionById(transaction.transaction_id);
            }
        }, 5000);
    }
}

// Simulate processing (replace with actual API call)
function simulateProcessing(transaction) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            // Simulate 80% success rate
            if (Math.random() > 0.2) {
                resolve();
            } else {
                reject(new Error('Processing failed (simulated)'));
            }
        }, 2000);
    });
}

// Retry transaction
async function retryTransaction(tripIndex, transactionIndex) {
    const groupedTrips = groupTransactionsByTrip();
    const transaction = groupedTrips[tripIndex].transactions[transactionIndex];

    addLogEntry('Retry', `Retrying transaction ${transaction.trx_number}...`, 'warning');

    transaction.transaction_status = 'PROCESSING';
    displayGroupedTrips();
    updateStatistics();

    await processTransaction(transaction);
}

// Retry transaction by ID
async function retryTransactionById(transactionId) {
    const transaction = autoProcessingData.find(t => t.transaction_id === transactionId);
    if (transaction) {
        await processTransaction(transaction);
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
window.toggleTripDetails = toggleTripDetails;
window.retryTransaction = retryTransaction;
window.switchAutoTab = switchAutoTab;

console.log('[Auto Processing] Script loaded successfully');

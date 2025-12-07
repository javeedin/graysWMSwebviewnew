// ============================================================================
// MRA (Mauritius Revenue Authority) Interface Processing
// ============================================================================
// Handles MRA invoice interface for orders from Trip Details screen
// Tabbed popup: Order Data | MRA Details | Logging
// ============================================================================

// Global state for MRA processing
let mraState = {
    orderNumber: '',
    instance: '',
    logs: [],
    orderHeader: null,
    orderDetails: null,
    mraRequest: null,
    mraResponse: null,
    qrCode: null,
    irnCode: null
};

/**
 * Add log entry
 */
function addMRALog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    mraState.logs.push({ timestamp, message, type });
    updateLoggingTab();
    console.log(`[MRA ${type.toUpperCase()}] ${message}`);
}

/**
 * Opens MRA processing popup with tabs
 */
async function openMRAProcessingPopup(orderNumber, instance) {
    // Reset state
    mraState = {
        orderNumber: orderNumber,
        instance: instance,
        logs: [],
        orderHeader: null,
        orderDetails: null,
        mraRequest: null,
        mraResponse: null,
        qrCode: null,
        irnCode: null
    };

    addMRALog(`Opening MRA popup for order: ${orderNumber}`, 'info');

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'mra-processing-overlay';
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
        z-index: 10000;
        backdrop-filter: blur(4px);
    `;

    // Create modal content
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        width: 900px;
        max-width: 95%;
        height: 700px;
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    `;

    modal.innerHTML = `
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <h2 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-file-invoice-dollar"></i>
                    MRA Interface - ${orderNumber}
                </h2>
                <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; opacity: 0.9;">Instance: ${instance || 'PROD'}</p>
            </div>
            <button id="mra-close-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1.25rem;">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <!-- Tabs -->
        <div style="display: flex; border-bottom: 2px solid #e2e8f0; background: #f8f9fa;">
            <button class="mra-tab active" data-tab="order" style="flex: 1; padding: 0.75rem 1rem; border: none; background: white; cursor: pointer; font-weight: 600; color: #667eea; border-bottom: 2px solid #667eea; margin-bottom: -2px;">
                <i class="fas fa-file-alt"></i> Order Data
            </button>
            <button class="mra-tab" data-tab="mra" style="flex: 1; padding: 0.75rem 1rem; border: none; background: transparent; cursor: pointer; font-weight: 600; color: #64748b;">
                <i class="fas fa-qrcode"></i> MRA Details
            </button>
            <button class="mra-tab" data-tab="logs" style="flex: 1; padding: 0.75rem 1rem; border: none; background: transparent; cursor: pointer; font-weight: 600; color: #64748b;">
                <i class="fas fa-list-alt"></i> Logging
            </button>
        </div>

        <!-- Tab Content -->
        <div style="flex: 1; overflow: hidden; position: relative;">
            <!-- Order Data Tab -->
            <div id="mra-tab-order" class="mra-tab-content" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; overflow-y: auto; padding: 1rem;">
                <div id="mra-order-loading" style="text-align: center; padding: 2rem;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #667eea;"></i>
                    <p style="margin-top: 1rem; color: #64748b;">Loading order data...</p>
                </div>
                <div id="mra-order-content" style="display: none;">
                    <h4 style="margin: 0 0 0.75rem 0; color: #2d3748; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem;">
                        <i class="fas fa-file-invoice"></i> Order Header
                    </h4>
                    <div id="mra-order-header" style="background: #f8f9fa; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; font-size: 0.85rem;">
                        No data
                    </div>

                    <h4 style="margin: 0 0 0.75rem 0; color: #2d3748; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem;">
                        <i class="fas fa-list"></i> Order Lines
                    </h4>
                    <div id="mra-order-lines" style="background: #f8f9fa; border-radius: 6px; padding: 1rem; font-size: 0.85rem; max-height: 300px; overflow-y: auto;">
                        No data
                    </div>
                </div>
            </div>

            <!-- MRA Details Tab -->
            <div id="mra-tab-mra" class="mra-tab-content" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; overflow-y: auto; padding: 1rem; display: none;">
                <div id="mra-status-banner" style="padding: 1rem; border-radius: 6px; margin-bottom: 1rem; background: #f0f9ff; border: 1px solid #bae6fd;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <i class="fas fa-info-circle" style="color: #0284c7;"></i>
                        <span style="font-weight: 600; color: #0369a1;">Processing...</span>
                    </div>
                </div>

                <h4 style="margin: 0 0 0.75rem 0; color: #2d3748;">
                    <i class="fas fa-server"></i> MRA Endpoint
                </h4>
                <div id="mra-endpoint" style="background: #1e293b; color: #94a3b8; border-radius: 6px; padding: 0.75rem; margin-bottom: 1rem; font-family: monospace; font-size: 0.8rem;">
                    Waiting...
                </div>

                <h4 style="margin: 0 0 0.75rem 0; color: #2d3748;">
                    <i class="fas fa-paper-plane"></i> Request JSON
                </h4>
                <pre id="mra-request-json" style="background: #1e293b; color: #22d3ee; border-radius: 6px; padding: 0.75rem; margin-bottom: 1rem; font-size: 0.75rem; max-height: 150px; overflow: auto;">Waiting...</pre>

                <h4 style="margin: 0 0 0.75rem 0; color: #2d3748;">
                    <i class="fas fa-reply"></i> Response JSON
                </h4>
                <pre id="mra-response-json" style="background: #1e293b; color: #4ade80; border-radius: 6px; padding: 0.75rem; margin-bottom: 1rem; font-size: 0.75rem; max-height: 150px; overflow: auto;">Waiting...</pre>

                <div id="mra-qr-section" style="display: none; text-align: center; padding: 1rem; background: #f0fdf4; border-radius: 6px; border: 2px solid #86efac;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #065f46;"><i class="fas fa-qrcode"></i> QR Code</h4>
                    <div id="mra-irn-code" style="font-family: monospace; font-size: 0.9rem; color: #047857; margin-bottom: 0.5rem;"></div>
                    <img id="mra-qr-image" style="max-width: 200px; border: 4px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
                </div>
            </div>

            <!-- Logging Tab -->
            <div id="mra-tab-logs" class="mra-tab-content" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; overflow-y: auto; padding: 1rem; display: none;">
                <div id="mra-logs-container" style="background: #1e293b; border-radius: 6px; padding: 1rem; font-family: monospace; font-size: 0.75rem; height: calc(100% - 2rem); overflow-y: auto;">
                    <div style="color: #64748b;">Waiting for logs...</div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div style="padding: 0.75rem 1.5rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #f8f9fa;">
            <div id="mra-status-text" style="font-size: 0.85rem; color: #64748b;">
                <i class="fas fa-spinner fa-spin"></i> Processing...
            </div>
            <button id="mra-close-btn-footer" style="padding: 0.5rem 1.5rem; background: #64748b; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                Close
            </button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Tab switching
    modal.querySelectorAll('.mra-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            modal.querySelectorAll('.mra-tab').forEach(t => {
                t.classList.remove('active');
                t.style.background = 'transparent';
                t.style.color = '#64748b';
                t.style.borderBottom = '2px solid transparent';
            });
            tab.classList.add('active');
            tab.style.background = 'white';
            tab.style.color = '#667eea';
            tab.style.borderBottom = '2px solid #667eea';

            modal.querySelectorAll('.mra-tab-content').forEach(c => c.style.display = 'none');
            document.getElementById(`mra-tab-${tab.dataset.tab}`).style.display = 'block';
        });
    });

    // Close handlers
    const closeModal = () => overlay.remove();
    document.getElementById('mra-close-btn').addEventListener('click', closeModal);
    document.getElementById('mra-close-btn-footer').addEventListener('click', closeModal);

    // Start processing
    await processMRAInterface(orderNumber, instance);
}

/**
 * Process MRA interface
 */
async function processMRAInterface(orderNumber, instance) {
    addMRALog(`Starting MRA processing for order: ${orderNumber}`, 'info');

    // For Fusion SOAP calls, we MUST use the service account from fusionuserdetails API
    // NOT the user's login credentials (localStorage username/password)
    let fusionUsername = window.F_username;
    let fusionPassword = window.F_password;

    // If global credentials not set, fetch from fusionuserdetails API
    if (!fusionUsername || !fusionPassword) {
        addMRALog('Fetching Fusion service account credentials from API...', 'info');
        try {
            const credentials = await fetchFusionCredentialsForMRA();
            if (credentials) {
                fusionUsername = credentials.username;
                fusionPassword = credentials.password;
            }
        } catch (fetchError) {
            addMRALog(`Failed to fetch credentials: ${fetchError.message}`, 'error');
        }
    } else {
        addMRALog(`Using cached Fusion credentials for user: ${fusionUsername}`, 'info');
    }

    // Validate that credentials exist
    if (!fusionUsername || !fusionPassword) {
        addMRALog('Error: Could not retrieve Fusion service account credentials from API.', 'error');
        updateMRAStatus(false, 'Could not retrieve Fusion credentials from fusionuserdetails API.');
        throw new Error('Could not retrieve Fusion credentials.');
    }

    const resolvedInstance = (instance && instance.trim()) ||
                             localStorage.getItem('fusionInstance') ||
                             localStorage.getItem('instanceName') ||
                             document.getElementById('current-instance-display')?.textContent ||
                             'PROD';

    addMRALog(`Instance: ${resolvedInstance}`, 'info');
    addMRALog(`Fusion Service Account: ${fusionUsername}`, 'success');
    addMRALog(`Credentials Source: fusionuserdetails API`, 'info');

    try {
        const requestId = Date.now().toString();
        const message = {
            action: 'processMRAInterface',
            requestId: requestId,
            orderNumber: orderNumber,
            fusionUsername: fusionUsername,
            fusionPassword: fusionPassword,
            instance: resolvedInstance
        };

        addMRALog(`Sending request to C# backend...`, 'info');

        window.pendingRequests = window.pendingRequests || {};
        window.pendingRequests[requestId] = handleMRAResponse;

        if (window.chrome?.webview) {
            window.chrome.webview.postMessage(message);
        } else {
            addMRALog('WebView2 not available!', 'error');
            updateMRAStatus(false, 'WebView2 not available');
        }
    } catch (error) {
        addMRALog(`Error: ${error.message}`, 'error');
        updateMRAStatus(false, error.message);
    }
}

/**
 * Handle MRA response
 */
function handleMRAResponse(error, data) {
    if (error) {
        addMRALog(`Processing failed: ${error}`, 'error');
        updateMRAStatus(false, error);
    } else {
        addMRALog(`Processing complete. Success: ${data.success}`, data.success ? 'success' : 'error');

        if (data.success) {
            mraState.irnCode = data.irnCode;
            mraState.qrCode = data.qrCodeBase64;
            updateQRSection();
        }

        updateMRAStatus(data.success, data.message);
    }
}

/**
 * Update MRA status
 */
function updateMRAStatus(success, message) {
    const statusBanner = document.getElementById('mra-status-banner');
    const statusText = document.getElementById('mra-status-text');
    const closeBtn = document.getElementById('mra-close-btn-footer');

    if (statusBanner) {
        if (success) {
            statusBanner.style.background = '#f0fdf4';
            statusBanner.style.border = '1px solid #86efac';
            statusBanner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-check-circle" style="color: #16a34a;"></i>
                    <span style="font-weight: 600; color: #15803d;">Success: ${message}</span>
                </div>
            `;
        } else {
            statusBanner.style.background = '#fef2f2';
            statusBanner.style.border = '1px solid #fca5a5';
            statusBanner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-exclamation-circle" style="color: #dc2626;"></i>
                    <span style="font-weight: 600; color: #b91c1c;">Failed: ${message}</span>
                </div>
            `;
        }
    }

    if (statusText) {
        statusText.innerHTML = success
            ? `<i class="fas fa-check-circle" style="color: #16a34a;"></i> Complete`
            : `<i class="fas fa-times-circle" style="color: #dc2626;"></i> Failed`;
    }

    if (closeBtn) {
        closeBtn.style.background = success ? '#16a34a' : '#dc2626';
    }
}

/**
 * Update QR section
 */
function updateQRSection() {
    const qrSection = document.getElementById('mra-qr-section');
    const irnCodeEl = document.getElementById('mra-irn-code');
    const qrImage = document.getElementById('mra-qr-image');

    if (qrSection && mraState.irnCode) {
        qrSection.style.display = 'block';
        if (irnCodeEl) irnCodeEl.textContent = `IRN: ${mraState.irnCode}`;
        if (qrImage && mraState.qrCode) {
            qrImage.src = `data:image/png;base64,${mraState.qrCode}`;
        }
    }
}

/**
 * Update logging tab
 */
function updateLoggingTab() {
    const container = document.getElementById('mra-logs-container');
    if (!container) return;

    container.innerHTML = mraState.logs.map(log => {
        let color = '#94a3b8';
        if (log.type === 'error') color = '#f87171';
        if (log.type === 'success') color = '#4ade80';
        if (log.type === 'warning') color = '#fbbf24';

        return `<div style="margin-bottom: 0.25rem; color: ${color};">
            <span style="color: #64748b;">[${log.timestamp}]</span> ${log.message}
        </div>`;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

/**
 * Update order data tab
 */
function updateOrderDataTab(headerData, linesData) {
    const loading = document.getElementById('mra-order-loading');
    const content = document.getElementById('mra-order-content');
    const headerEl = document.getElementById('mra-order-header');
    const linesEl = document.getElementById('mra-order-lines');

    if (loading) loading.style.display = 'none';
    if (content) content.style.display = 'block';

    if (headerEl && headerData) {
        headerEl.innerHTML = Object.entries(headerData).map(([key, value]) =>
            `<div style="display: flex; border-bottom: 1px solid #e2e8f0; padding: 0.25rem 0;">
                <span style="width: 40%; font-weight: 600; color: #475569;">${key}:</span>
                <span style="color: #1e293b;">${value || '-'}</span>
            </div>`
        ).join('');
    }

    if (linesEl && linesData && linesData.length > 0) {
        linesEl.innerHTML = `
            <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
                <thead>
                    <tr style="background: #e2e8f0;">
                        ${Object.keys(linesData[0]).map(k => `<th style="padding: 0.5rem; text-align: left; border: 1px solid #cbd5e1;">${k}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${linesData.map(row => `<tr>${Object.values(row).map(v => `<td style="padding: 0.4rem; border: 1px solid #e2e8f0;">${v || '-'}</td>`).join('')}</tr>`).join('')}
                </tbody>
            </table>
        `;
    }
}

/**
 * Update MRA request/response display
 */
function updateMRARequestResponse(endpoint, request, response) {
    const endpointEl = document.getElementById('mra-endpoint');
    const requestEl = document.getElementById('mra-request-json');
    const responseEl = document.getElementById('mra-response-json');

    if (endpointEl && endpoint) endpointEl.textContent = endpoint;
    if (requestEl && request) requestEl.textContent = JSON.stringify(request, null, 2);
    if (responseEl && response) responseEl.textContent = JSON.stringify(response, null, 2);
}

// Listen for messages from C#
if (window.chrome?.webview) {
    window.chrome.webview.addEventListener('message', function(event) {
        const data = event.data;

        if (data.action === 'mraProcessingProgress') {
            addMRALog(`[${data.step}] ${data.message}`, 'info');
        } else if (data.action === 'mraOrderData') {
            // Receive order data from C#
            addMRALog('Received order data', 'info');
            updateOrderDataTab(data.header, data.lines);
        } else if (data.action === 'mraRequestData') {
            // Receive MRA request info
            addMRALog(`MRA Endpoint: ${data.endpoint}`, 'info');
            updateMRARequestResponse(data.endpoint, data.request, null);
        } else if (data.action === 'mraResponseData') {
            // Receive MRA response
            addMRALog('Received MRA response', data.success ? 'success' : 'error');
            updateMRARequestResponse(null, null, data.response);
        } else if (data.action === 'processMRAInterfaceResponse') {
            addMRALog(`Final result: ${data.success ? 'SUCCESS' : 'FAILED'} - ${data.message}`, data.success ? 'success' : 'error');

            if (window.pendingRequests && window.pendingRequests[data.requestId]) {
                window.pendingRequests[data.requestId](data.success ? null : data.message, data);
                delete window.pendingRequests[data.requestId];
            }
        }
    });
}

/**
 * Fetch Fusion credentials from API (fallback when global credentials not available)
 */
function fetchFusionCredentialsForMRA() {
    return new Promise((resolve, reject) => {
        const credentialsUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fusionuserdetails';

        addMRALog(`Fetching credentials from: ${credentialsUrl}`, 'info');

        // Check if sendMessageToCSharp is available (from app.js)
        if (typeof sendMessageToCSharp !== 'function') {
            reject(new Error('sendMessageToCSharp function not available'));
            return;
        }

        sendMessageToCSharp({
            action: "executeGet",
            fullUrl: credentialsUrl
        }, function(error, data) {
            if (error) {
                addMRALog(`API call failed: ${error}`, 'error');
                reject(new Error(error));
                return;
            }

            try {
                const response = JSON.parse(data);
                if (response.items && response.items.length > 0) {
                    const username = response.items[0].user_name || '';
                    const password = response.items[0].passwordd || '';

                    // Also set global properties for future use
                    window.F_username = username;
                    window.F_password = password;

                    addMRALog(`Credentials loaded for user: ${username}`, 'success');
                    resolve({ username, password });
                } else {
                    addMRALog('No credentials found in API response', 'error');
                    reject(new Error('No credentials found in API response'));
                }
            } catch (parseError) {
                addMRALog(`Failed to parse credentials: ${parseError.message}`, 'error');
                reject(parseError);
            }
        });
    });
}

console.log('[MRA] MRA processor module loaded (tabbed version)');

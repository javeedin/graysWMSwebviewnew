/* WMS 2.0 — VERBATIM COPY of the WMS bridge pieces the copied dialogs need (wms/app.js):
   lines 7-17 (globals + dialog grid variables), 23-89 (showNotification), 690-798 (generateRequestId,
   sendMessageToCSharp, extractEndpointFromUrl) and 2045-2123 (the WebView2 message listener).
   The WMS module itself is not changed. WMS 2.0's own code (w2-core.js) uses this same bridge. */
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

// Simple toast notification function
window.showNotification = function(message, type = 'info') {
    console.log(`[Notification] ${type.toUpperCase()}: ${message}`);

    // Remove existing notification if any
    const existing = document.getElementById('wms-notification-toast');
    if (existing) existing.remove();

    // Define colors based on type
    const colors = {
        success: { bg: '#22c55e', icon: 'fa-check-circle' },
        error: { bg: '#ef4444', icon: 'fa-times-circle' },
        warning: { bg: '#f59e0b', icon: 'fa-exclamation-triangle' },
        info: { bg: '#3b82f6', icon: 'fa-info-circle' }
    };

    const color = colors[type] || colors.info;

    // Create toast element
    const toast = document.createElement('div');
    toast.id = 'wms-notification-toast';
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${color.bg};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        font-weight: 500;
        max-width: 400px;
        animation: slideIn 0.3s ease-out;
    `;

    toast.innerHTML = `<i class="fas ${color.icon}"></i> <span>${message}</span>`;

    // Add animation keyframes if not already added
    if (!document.getElementById('wms-notification-styles')) {
        const style = document.createElement('style');
        style.id = 'wms-notification-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // Auto-remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

function generateRequestId() {
    return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}



function sendMessageToCSharp(message, callback, timeoutMs = 120000, showIndicator = true) {
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

    // Show processing indicator for this service call
    if (showIndicator && typeof window.showProcessingIndicator === 'function') {
        const serviceName = getServiceDisplayName(message.action, message.fullUrl);
        const detail = message.fullUrl ? extractEndpointFromUrl(message.fullUrl) : '';
        window.showProcessingIndicator(requestId, serviceName, detail);
    }

    // Setup timeout to catch stuck requests
    const timeoutId = setTimeout(() => {
        if (window.pendingRequests[requestId]) {
            const elapsed = Date.now() - startTime;
            console.error('[JS] ⏰ TIMEOUT! Request timed out after', elapsed, 'ms');
            console.error('[JS] ⏰ Timed out Request ID:', requestId);
            console.error('[JS] ⏰ Timed out Action:', message.action);
            console.error('[JS] ⏰ Check if C# received and processed this request');

            // Hide processing indicator on timeout
            if (typeof window.hideProcessingIndicator === 'function') {
                window.hideProcessingIndicator(requestId);
            }

            delete window.pendingRequests[requestId];
            callback(`Request timed out after ${timeoutMs}ms. C# did not respond for action: ${message.action}`, null);
        }
    }, timeoutMs);

    // Wrap callback to clear timeout when response arrives
    window.pendingRequests[requestId] = function(error, response) {
        clearTimeout(timeoutId);
        const elapsed = Date.now() - startTime;
        console.log('[JS] ⏱️ Response received in', elapsed, 'ms for:', requestId);

        // Hide processing indicator when response arrives
        if (typeof window.hideProcessingIndicator === 'function') {
            window.hideProcessingIndicator(requestId);
        }

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

            // Hide processing indicator on error
            if (typeof window.hideProcessingIndicator === 'function') {
                window.hideProcessingIndicator(requestId);
            }

            delete window.pendingRequests[requestId];
            callback('Error posting message to C#: ' + postError.message, null);
        }
    } else {
        console.error('[JS] ❌ WebView2 not available - window.chrome.webview is:', window.chrome?.webview);
        clearTimeout(timeoutId);

        // Hide processing indicator when WebView2 not available
        if (typeof window.hideProcessingIndicator === 'function') {
            window.hideProcessingIndicator(requestId);
        }

        delete window.pendingRequests[requestId];
        callback('WebView2 not available', null);
    }
}

// Helper function to extract readable endpoint from URL
function extractEndpointFromUrl(url) {
    if (!url) return '';
    try {
        const urlObj = new URL(url);
        const path = urlObj.pathname;
        // Get the last meaningful part of the path
        const parts = path.split('/').filter(p => p && !p.match(/^v\d+$/));
        if (parts.length > 0) {
            return parts[parts.length - 1];
        }
    } catch (e) {
        // If URL parsing fails, try to extract the endpoint manually
        const match = url.match(/\/([^\/\?]+)(?:\?|$)/);
        if (match) return match[1];
    }
    return '';
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
                console.log('[JS] 📋 Handling as restResponse, statusCode:', response.statusCode, 'success:', response.success);
                if (response.success === false) {
                    callback({ message: `HTTP ${response.statusCode}`, statusCode: response.statusCode, body: response.data }, null);
                } else {
                    callback(null, response.data, response.statusCode);
                }
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

// Not in wms/app.js but called by the copied cancel buttons (cancelScheduledLines …): there they threw
// "showLoading is not defined". WMS 2.0 shows its own busy banner instead.
window.showLoading = window.showLoading || function (msg) { if (window.W2 && W2.busy) W2.busy.start(msg || 'Working…'); };
window.hideLoading = window.hideLoading || function () { if (window.W2 && W2.busy) W2.busy.done(); };

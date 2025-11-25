// ============================================================================
// MRA (Mauritius Revenue Authority) Interface Processing
// ============================================================================
//  Handles MRA invoice interface for orders from Trip Details screen
// ============================================================================

/**
 * Opens MRA processing popup and initiates MRA interface for an order
 * @param {string} orderNumber - The order number to process
 * @param {string} instance - The instance name (e.g., 'PROD', 'TEST')
 */
async function openMRAProcessingPopup(orderNumber, instance) {
    console.log('[MRA] Opening MRA processing popup for order:', orderNumber, 'Instance:', instance);

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
        width: 600px;
        max-width: 90%;
        max-height: 80vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    `;

    // Modal header
    const header = document.createElement('div');
    header.style.cssText = `
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
    `;
    header.innerHTML = `
        <div>
            <h2 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-file-invoice-dollar"></i>
                MRA Interface Processing
            </h2>
            <p style="margin: 0.25rem 0 0 0; font-size: 0.875rem; opacity: 0.9;">
                Order: ${orderNumber}
            </p>
        </div>
        <button id="mra-close-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1.25rem; display: flex; align-items: center; justify-content: center;">
            <i class="fas fa-times"></i>
        </button>
    `;

    // Modal body
    const body = document.createElement('div');
    body.style.cssText = `
        padding: 1.5rem;
        flex: 1;
        overflow-y: auto;
    `;

    // Progress container
    const progressContainer = document.createElement('div');
    progressContainer.id = 'mra-progress-container';
    progressContainer.style.cssText = `
        margin-bottom: 1.5rem;
    `;

    // Progress steps
    const progressSteps = document.createElement('div');
    progressSteps.id = 'mra-progress-steps';
    progressSteps.innerHTML = `
        <div class="mra-step" data-step="CheckingMRAStatus" style="display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
            <div class="mra-step-icon" style="width: 32px; height: 32px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-circle" style="font-size: 0.5rem; color: #94a3b8;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; color: #2d3748; margin-bottom: 0.25rem;">Step 1: Check MRA Status</div>
                <div class="mra-step-message" style="font-size: 0.875rem; color: #64748b;">Waiting...</div>
            </div>
        </div>

        <div class="mra-step" data-step="FetchingOrderSummary" style="display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
            <div class="mra-step-icon" style="width: 32px; height: 32px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-circle" style="font-size: 0.5rem; color: #94a3b8;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; color: #2d3748; margin-bottom: 0.25rem;">Step 2: Fetch Order Summary</div>
                <div class="mra-step-message" style="font-size: 0.875rem; color: #64748b;">Waiting...</div>
            </div>
        </div>

        <div class="mra-step" data-step="FetchingOrderDetails" style="display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
            <div class="mra-step-icon" style="width: 32px; height: 32px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-circle" style="font-size: 0.5rem; color: #94a3b8;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; color: #2d3748; margin-bottom: 0.25rem;">Step 3: Fetch Order Details</div>
                <div class="mra-step-message" style="font-size: 0.875rem; color: #64748b;">Waiting...</div>
            </div>
        </div>

        <div class="mra-step" data-step="ValidatingOrderLines" style="display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
            <div class="mra-step-icon" style="width: 32px; height: 32px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-circle" style="font-size: 0.5rem; color: #94a3b8;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; color: #2d3748; margin-bottom: 0.25rem;">Step 4: Validate Order Lines</div>
                <div class="mra-step-message" style="font-size: 0.875rem; color: #64748b;">Waiting...</div>
            </div>
        </div>

        <div class="mra-step" data-step="CreatingMRAInvoice" style="display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
            <div class="mra-step-icon" style="width: 32px; height: 32px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-circle" style="font-size: 0.5rem; color: #94a3b8;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; color: #2d3748; margin-bottom: 0.25rem;">Step 5: Create MRA Invoice</div>
                <div class="mra-step-message" style="font-size: 0.875rem; color: #64748b;">Waiting...</div>
            </div>
        </div>

        <div class="mra-step" data-step="UpdatingFusionOrder" style="display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
            <div class="mra-step-icon" style="width: 32px; height: 32px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-circle" style="font-size: 0.5rem; color: #94a3b8;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; color: #2d3748; margin-bottom: 0.25rem;">Step 6: Update Fusion Order</div>
                <div class="mra-step-message" style="font-size: 0.875rem; color: #64748b;">Waiting...</div>
            </div>
        </div>
    `;
    progressContainer.appendChild(progressSteps);

    // Result container (hidden initially)
    const resultContainer = document.createElement('div');
    resultContainer.id = 'mra-result-container';
    resultContainer.style.display = 'none';

    body.appendChild(progressContainer);
    body.appendChild(resultContainer);

    // Modal footer
    const footer = document.createElement('div');
    footer.style.cssText = `
        padding: 1rem 1.5rem;
        border-top: 1px solid #e2e8f0;
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
    `;
    footer.innerHTML = `
        <button id="mra-cancel-btn" style="padding: 0.5rem 1.25rem; background: #94a3b8; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
            Cancel
        </button>
    `;

    // Assemble modal
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close handlers
    const closeModal = () => {
        overlay.remove();
    };

    document.getElementById('mra-close-btn').addEventListener('click', closeModal);
    document.getElementById('mra-cancel-btn').addEventListener('click', closeModal);

    // Start MRA processing
    await processMRAInterface(orderNumber, instance);
}

/**
 * Processes MRA interface by calling C# backend
 * @param {string} orderNumber - The order number to process
 * @param {string} instance - The instance name from the grid row
 */
async function processMRAInterface(orderNumber, instance) {
    console.log('[MRA] Starting MRA interface processing for order:', orderNumber, 'Instance:', instance);

    // Get credentials from localStorage
    const fusionUsername = localStorage.getItem('fusionCloudUsername') || 'shaik';
    const fusionPassword = localStorage.getItem('fusionCloudPassword') || 'fusion1234';
    // Use instance from parameter (from grid row), fallback to localStorage if not provided
    const resolvedInstance = instance || localStorage.getItem('instanceName') || 'TEST';
    console.log('[MRA] Using instance:', resolvedInstance, '(from parameter:', instance, ')');

    try {
        // Send request to C# backend
        const requestId = Date.now().toString();
        const message = {
            action: 'processMRAInterface',
            requestId: requestId,
            orderNumber: orderNumber,
            fusionUsername: fusionUsername,
            fusionPassword: fusionPassword,
            instance: resolvedInstance
        };

        console.log('[MRA] Sending request to C# backend:', message);

        // Register response handler
        window.pendingRequests = window.pendingRequests || {};
        window.pendingRequests[requestId] = handleMRAProcessingComplete;

        // Post message to C#
        if (window.chrome?.webview) {
            window.chrome.webview.postMessage(message);
        } else {
            console.error('[MRA] WebView2 not available');
            updateMRAResult(false, 'WebView2 not available', null);
        }
    } catch (error) {
        console.error('[MRA] Error starting MRA processing:', error);
        updateMRAResult(false, error.message, null);
    }
}

/**
 * Handles MRA processing completion response from C#
 * @param {string} error - Error message if failed
 * @param {object} data - Response data from C#
 */
function handleMRAProcessingComplete(error, data) {
    console.log('[MRA] Processing complete. Error:', error, 'Data:', data);

    if (error) {
        updateMRAResult(false, error, null);
    } else {
        updateMRAResult(data.success, data.message, data);
    }
}

/**
 * Updates a processing step with current status
 * @param {string} step - Step name
 * @param {string} message - Step message
 * @param {string} status - Status (processing, success, error)
 */
function updateMRAStep(step, message, status = 'processing') {
    const stepElement = document.querySelector(`.mra-step[data-step="${step}"]`);
    if (!stepElement) return;

    const iconElement = stepElement.querySelector('.mra-step-icon');
    const messageElement = stepElement.querySelector('.mra-step-message');

    messageElement.textContent = message;

    if (status === 'processing') {
        iconElement.style.background = '#3b82f6';
        iconElement.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: white;"></i>';
    } else if (status === 'success') {
        iconElement.style.background = '#10b981';
        iconElement.innerHTML = '<i class="fas fa-check" style="color: white;"></i>';
    } else if (status === 'error') {
        iconElement.style.background = '#ef4444';
        iconElement.innerHTML = '<i class="fas fa-times" style="color: white;"></i>';
    }
}

/**
 * Updates the result container with final result
 * @param {boolean} success - Whether processing succeeded
 * @param {string} message - Result message
 * @param {object} data - Result data (IRN code, QR code, etc.)
 */
function updateMRAResult(success, message, data) {
    const resultContainer = document.getElementById('mra-result-container');
    const progressContainer = document.getElementById('mra-progress-container');

    if (!resultContainer) return;

    // Hide progress, show result
    progressContainer.style.display = 'none';
    resultContainer.style.display = 'block';

    if (success) {
        resultContainer.innerHTML = `
            <div style="padding: 1.5rem; background: #f0fdf4; border: 2px solid #86efac; border-radius: 8px; text-align: center;">
                <div style="width: 64px; height: 64px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
                    <i class="fas fa-check" style="font-size: 2rem; color: white;"></i>
                </div>
                <h3 style="margin: 0 0 0.5rem 0; color: #065f46; font-size: 1.25rem;">MRA Interface Successful!</h3>
                <p style="margin: 0 0 1rem 0; color: #047857;">${message}</p>
                ${data && data.irnCode ? `
                    <div style="background: white; padding: 1rem; border-radius: 6px; margin-top: 1rem;">
                        <div style="font-weight: 600; color: #065f46; margin-bottom: 0.5rem;">IRN Code:</div>
                        <div style="font-family: monospace; font-size: 1.125rem; color: #047857;">${data.irnCode}</div>
                    </div>
                ` : ''}
            </div>
        `;

        // Update close button
        const cancelBtn = document.getElementById('mra-cancel-btn');
        if (cancelBtn) {
            cancelBtn.textContent = 'Close';
            cancelBtn.style.background = '#10b981';
        }
    } else {
        resultContainer.innerHTML = `
            <div style="padding: 1.5rem; background: #fef2f2; border: 2px solid #fca5a5; border-radius: 8px; text-align: center;">
                <div style="width: 64px; height: 64px; background: #ef4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: white;"></i>
                </div>
                <h3 style="margin: 0 0 0.5rem 0; color: #991b1b; font-size: 1.25rem;">MRA Interface Failed</h3>
                <p style="margin: 0; color: #b91c1c;">${message}</p>
                ${data && data.errorDetails ? `
                    <details style="margin-top: 1rem; text-align: left;">
                        <summary style="cursor: pointer; color: #991b1b; font-weight: 600;">Error Details</summary>
                        <pre style="margin-top: 0.5rem; padding: 0.75rem; background: white; border-radius: 4px; font-size: 0.75rem; overflow-x: auto; color: #7f1d1d;">${data.errorDetails}</pre>
                    </details>
                ` : ''}
            </div>
        `;
    }
}

// Listen for progress updates from C#
if (window.chrome?.webview) {
    const originalListener = window.chrome.webview.addEventListener;
    window.chrome.webview.addEventListener('message', function(event) {
        const data = event.data;

        if (data.action === 'mraProcessingProgress') {
            console.log('[MRA] Progress update:', data.step, data.message);
            updateMRAStep(data.step, data.message, 'processing');
        } else if (data.action === 'processMRAInterfaceResponse') {
            console.log('[MRA] Final response received:', data);

            // Mark current step as complete or failed
            if (data.currentStep) {
                updateMRAStep(data.currentStep, data.message, data.success ? 'success' : 'error');
            }

            // Handle via pending request
            if (window.pendingRequests && window.pendingRequests[data.requestId]) {
                window.pendingRequests[data.requestId](data.success ? null : data.message, data);
                delete window.pendingRequests[data.requestId];
            }
        }
    });
}

console.log('[MRA] MRA processor module loaded');

// ============================================================================
// WMS CO-PILOT - Enhanced with Chat & Prompts
// ============================================================================

console.log('[Co-Pilot] Loading...');

// Global state
const CopilotState = {
    currentTab: 'actions',
    chatHistory: [],
    isProcessing: false
};

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('[Co-Pilot] Initializing...');

    // Toggle Co-Pilot Panel
    window.toggleCopilot = function() {
        const panel = document.getElementById('copilot-panel');
        const overlay = document.getElementById('copilot-overlay');

        if (panel && overlay) {
            const isOpen = panel.classList.contains('open');

            if (isOpen) {
                panel.classList.remove('open');
                overlay.classList.remove('open');
                console.log('[Co-Pilot] Panel closed');
            } else {
                panel.classList.add('open');
                overlay.classList.add('open');
                console.log('[Co-Pilot] Panel opened');

                // Focus on chat input if chat tab is active
                if (CopilotState.currentTab === 'chat') {
                    setTimeout(() => {
                        const input = document.getElementById('copilot-chat-input');
                        if (input) input.focus();
                    }, 300);
                }
            }
        }
    };

    // Switch tabs
    window.switchCopilotTab = function(tab) {
        CopilotState.currentTab = tab;

        // Update tab buttons
        document.querySelectorAll('.copilot-tab').forEach(t => {
            t.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');

        // Update tab content
        document.querySelectorAll('.copilot-tab-content').forEach(c => {
            c.classList.remove('active');
        });
        document.getElementById(`copilot-${tab}-content`)?.classList.add('active');

        // Focus on input when switching to chat
        if (tab === 'chat') {
            setTimeout(() => {
                const input = document.getElementById('copilot-chat-input');
                if (input) input.focus();
            }, 100);
        }

        console.log('[Co-Pilot] Switched to tab:', tab);
    };

    // Execute quick action
    window.copilotAction = function(action, actionName) {
        console.log('[Co-Pilot] Action:', action);

        switch(action) {
            case 'createTrip':
                // Open the New Trip modal directly
                openNewTripModal();
                break;
            case 'addToTrip':
            case 'printOrder':
            case 'printTrip':
            case 'autoSchedule':
            case 'optimizeRoute':
                // For other actions, show in chat
                addChatMessage('user', actionName || action);
                switchCopilotTab('chat');

                setTimeout(() => {
                    let response = '';

                    if (action === 'addToTrip') {
                        response = '📦 To add orders to an existing trip, I need:\n\n• Trip ID\n• Order numbers to add\n\n(Full implementation coming soon)';
                    } else if (action === 'printOrder') {
                        response = '🖨️ I can help you print orders. Please specify:\n\n• Order numbers\n• Printer to use\n\n(Full implementation coming soon)';
                    } else if (action === 'printTrip') {
                        response = '📄 Please enter the Trip ID to view trip details:';

                        // Add input field for trip ID
                        setTimeout(() => {
                            const chatMessages = document.getElementById('copilot-chat-messages');
                            const inputDiv = document.createElement('div');
                            inputDiv.className = 'copilot-message copilot-message-assistant';
                            inputDiv.innerHTML = `
                                <div class="copilot-message-avatar">
                                    <i class="fas fa-robot"></i>
                                </div>
                                <div class="copilot-message-bubble">
                                    <div style="margin-bottom: 0.5rem;">Enter Trip ID:</div>
                                    <input type="text" id="copilot-trip-id-input"
                                           placeholder="e.g., 12345"
                                           style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                                           onkeypress="if(event.key==='Enter') handleTripIdSubmit()">
                                    <button onclick="handleTripIdSubmit()"
                                            style="margin-top: 0.5rem; padding: 0.5rem 1rem; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
                                        <i class="fas fa-search"></i> View Trip Details
                                    </button>
                                </div>
                            `;
                            chatMessages.appendChild(inputDiv);
                            chatMessages.scrollTop = chatMessages.scrollHeight;

                            // Focus on input
                            setTimeout(() => {
                                document.getElementById('copilot-trip-id-input')?.focus();
                            }, 100);
                        }, 100);
                    } else if (action === 'autoSchedule') {
                        response = '🤖 Auto-scheduling feature will:\n\n• Analyze pending orders\n• Optimize routes\n• Assign to available lorries\n• Consider delivery priorities\n\n(Full implementation coming soon)';
                    } else if (action === 'optimizeRoute') {
                        response = '🗺️ Route optimization will:\n\n• Minimize travel distance\n• Reduce delivery time\n• Consider traffic patterns\n• Maximize efficiency\n\n(Full implementation coming soon)';
                    }

                    addChatMessage('assistant', response);
                }, 500);
                break;
            default:
                addChatMessage('user', actionName || action);
                switchCopilotTab('chat');
                setTimeout(() => {
                    addChatMessage('assistant', `Processing action: ${actionName || action}\n\n(Implementation coming soon)`);
                }, 500);
        }
    };

    // Use prompt
    window.usePrompt = function(promptText) {
        const input = document.getElementById('copilot-chat-input');
        if (input) {
            input.value = promptText;
            input.focus();
        }
    };

    // Send chat message
    window.sendCopilotMessage = function() {
        const input = document.getElementById('copilot-chat-input');
        const message = input?.value.trim();

        if (!message || CopilotState.isProcessing) return;

        // Add user message
        addChatMessage('user', message);
        input.value = '';

        // Simulate AI processing
        CopilotState.isProcessing = true;

        setTimeout(() => {
            const response = generateResponse(message);
            addChatMessage('assistant', response);
            CopilotState.isProcessing = false;
        }, 1000);
    };

    // Add message to chat
    function addChatMessage(role, content) {
        const chatMessages = document.getElementById('copilot-chat-messages');
        if (!chatMessages) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `copilot-message copilot-message-${role}`;

        const avatar = document.createElement('div');
        avatar.className = 'copilot-message-avatar';
        avatar.innerHTML = role === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';

        const bubble = document.createElement('div');
        bubble.className = 'copilot-message-bubble';
        bubble.textContent = content;

        messageDiv.appendChild(avatar);
        messageDiv.appendChild(bubble);
        chatMessages.appendChild(messageDiv);

        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Store in history
        CopilotState.chatHistory.push({ role, content, timestamp: new Date() });
    }

    // Generate response (placeholder - will be replaced with AI integration)
    function generateResponse(message) {
        const lowerMsg = message.toLowerCase();

        if (lowerMsg.includes('create') && lowerMsg.includes('trip')) {
            return '🚚 I can help you create a new trip. What date would you like to schedule it for?';
        } else if (lowerMsg.includes('print')) {
            return '🖨️ I can help with printing. What would you like to print? (order/trip/all)';
        } else if (lowerMsg.includes('optimize') || lowerMsg.includes('route')) {
            return '🗺️ I can optimize routes for you. Which trip would you like to optimize?';
        } else if (lowerMsg.includes('schedule')) {
            return '📅 I can help with scheduling. Would you like to auto-schedule pending orders?';
        } else if (lowerMsg.includes('help')) {
            return '👋 I can assist you with:\n\n• Creating trips\n• Adding orders to trips\n• Printing documents\n• Route optimization\n• Auto-scheduling\n\nWhat would you like help with?';
        } else {
            return '💡 I understand you need help with: "' + message + '"\n\nThis feature is being developed. For now, try using the Quick Actions or ask me about creating trips, printing, or scheduling.';
        }
    }

    // Handle Enter key in chat input
    const chatInput = document.getElementById('copilot-chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendCopilotMessage();
            }
        });
    }

    // Keyboard shortcut: Alt+C to toggle
    document.addEventListener('keydown', function(e) {
        if (e.altKey && e.key === 'c') {
            e.preventDefault();
            toggleCopilot();
        }
    });

    // Initialize with welcome message
    setTimeout(() => {
        addChatMessage('assistant', '👋 Hi! I\'m your WMS Co-Pilot. I can help you with trip management, printing, and scheduling. How can I assist you today?');
    }, 500);

    console.log('[Co-Pilot] ✅ Ready! (Press Alt+C to toggle)');
});

// ============================================================================
// NEW TRIP MODAL FUNCTIONS
// ============================================================================

// Open New Trip Modal
window.openNewTripModal = async function() {
    console.log('[New Trip] Opening modal...');

    const modal = document.getElementById('new-trip-modal');
    const loading = document.getElementById('new-trip-loading');
    const formContent = document.getElementById('new-trip-form-content');

    if (!modal) {
        console.error('[New Trip] Modal element not found');
        return;
    }

    // Show modal with loading state
    modal.style.display = 'flex';
    loading.style.display = 'block';
    formContent.style.display = 'none';

    // Close copilot panel
    const copilotPanel = document.getElementById('copilot-panel');
    const copilotOverlay = document.getElementById('copilot-overlay');
    if (copilotPanel) copilotPanel.classList.remove('open');
    if (copilotOverlay) copilotOverlay.classList.remove('open');

    try {
        // Check and load vehicles and pickers
        await loadDataForNewTrip();

        // Populate form
        populateNewTripForm();

        // Hide loading, show form
        loading.style.display = 'none';
        formContent.style.display = 'block';

        console.log('[New Trip] Modal ready');
    } catch (error) {
        console.error('[New Trip] Error loading data:', error);
        alert('Error loading form data: ' + error.message);
        closeNewTripModal();
    }
};

// Close New Trip Modal
window.closeNewTripModal = function() {
    const modal = document.getElementById('new-trip-modal');
    if (modal) {
        modal.style.display = 'none';
        resetNewTripForm();
    }
};

// Load data for new trip (vehicles and pickers)
async function loadDataForNewTrip() {
    const vehiclesStatus = document.getElementById('vehicles-status');
    const pickersStatus = document.getElementById('pickers-status');

    console.log('[New Trip] Checking data availability...');

    // Check if vehicles data is loaded
    const needsVehicles = !window.vehiclesData || window.vehiclesData.length === 0;
    const needsPickers = !window.pickersData || window.pickersData.length === 0;

    const promises = [];

    if (needsVehicles) {
        console.log('[New Trip] Loading vehicles...');
        vehiclesStatus.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading vehicles...';

        promises.push(
            new Promise((resolve, reject) => {
                if (typeof window.loadVehicles === 'function') {
                    // Call loadVehicles and wait for it to complete
                    const checkVehicles = setInterval(() => {
                        if (window.vehiclesData && window.vehiclesData.length > 0) {
                            clearInterval(checkVehicles);
                            vehiclesStatus.innerHTML = '<i class="fas fa-check-circle" style="color: #28a745;"></i> Vehicles loaded (' + window.vehiclesData.length + ')';
                            resolve();
                        }
                    }, 500);

                    // Timeout after 10 seconds
                    setTimeout(() => {
                        clearInterval(checkVehicles);
                        if (!window.vehiclesData || window.vehiclesData.length === 0) {
                            reject(new Error('Timeout loading vehicles'));
                        }
                    }, 10000);

                    window.loadVehicles();
                } else {
                    reject(new Error('loadVehicles function not available'));
                }
            })
        );
    } else {
        console.log('[New Trip] Vehicles already loaded:', window.vehiclesData.length);
        vehiclesStatus.innerHTML = '<i class="fas fa-check-circle" style="color: #28a745;"></i> Vehicles loaded (' + window.vehiclesData.length + ')';
    }

    if (needsPickers) {
        console.log('[New Trip] Loading pickers...');
        pickersStatus.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading pickers...';

        promises.push(
            new Promise((resolve, reject) => {
                if (typeof window.loadPickers === 'function') {
                    // Call loadPickers and wait for it to complete
                    const checkPickers = setInterval(() => {
                        if (window.pickersData && window.pickersData.length > 0) {
                            clearInterval(checkPickers);
                            pickersStatus.innerHTML = '<i class="fas fa-check-circle" style="color: #28a745;"></i> Pickers loaded (' + window.pickersData.length + ')';
                            resolve();
                        }
                    }, 500);

                    // Timeout after 10 seconds
                    setTimeout(() => {
                        clearInterval(checkPickers);
                        if (!window.pickersData || window.pickersData.length === 0) {
                            reject(new Error('Timeout loading pickers'));
                        }
                    }, 10000);

                    window.loadPickers();
                } else {
                    reject(new Error('loadPickers function not available'));
                }
            })
        );
    } else {
        console.log('[New Trip] Pickers already loaded:', window.pickersData.length);
        pickersStatus.innerHTML = '<i class="fas fa-check-circle" style="color: #28a745;"></i> Pickers loaded (' + window.pickersData.length + ')';
    }

    // Wait for all data to load
    if (promises.length > 0) {
        await Promise.all(promises);
    }

    console.log('[New Trip] All data loaded');
}

// Populate New Trip Form
function populateNewTripForm() {
    console.log('[New Trip] Populating form...');

    // Set default dates to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('new-trip-date').value = today;
    document.getElementById('new-trip-cost-date').value = today;

    // Populate vehicles dropdown
    const vehicleSelect = document.getElementById('new-trip-vehicle');
    vehicleSelect.innerHTML = '<option value="">Select Vehicle</option>';

    if (window.vehiclesData && window.vehiclesData.length > 0) {
        window.vehiclesData.forEach(vehicle => {
            const option = document.createElement('option');
            option.value = vehicle.lorry_number;
            option.textContent = `${vehicle.lorry_number}${vehicle.assigned_route ? ' - ' + vehicle.assigned_route : ''}`;
            vehicleSelect.appendChild(option);
        });
        console.log('[New Trip] Populated vehicles:', window.vehiclesData.length);
    }

    // Populate pickers dropdown
    const pickerSelect = document.getElementById('new-trip-picker');
    pickerSelect.innerHTML = '<option value="">Select Picker</option>';

    if (window.pickersData && window.pickersData.length > 0) {
        // Filter out deleted pickers
        const activePickers = window.pickersData.filter(p => p.deleted !== 1);
        activePickers.forEach(picker => {
            const option = document.createElement('option');
            option.value = picker.picker_id;
            option.textContent = `${picker.name}${picker.picker_type ? ' (' + picker.picker_type + ')' : ''}`;
            pickerSelect.appendChild(option);
        });
        console.log('[New Trip] Populated pickers:', activePickers.length);
    }

    // Populate priority dropdown (1-20)
    const prioritySelect = document.getElementById('new-trip-priority');
    prioritySelect.innerHTML = '<option value="">Select Priority</option>';
    for (let i = 1; i <= 20; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Priority ${i}`;
        prioritySelect.appendChild(option);
    }

    // Populate loading bay dropdown (L1-L30)
    const loadingBaySelect = document.getElementById('new-trip-loading-bay');
    loadingBaySelect.innerHTML = '<option value="">Select Loading Bay</option>';
    for (let i = 1; i <= 30; i++) {
        const option = document.createElement('option');
        const bay = `L${i}`;
        option.value = bay;
        option.textContent = `Loading Bay ${bay}`;
        loadingBaySelect.appendChild(option);
    }

    console.log('[New Trip] Form populated successfully');
}

// Reset form
function resetNewTripForm() {
    document.getElementById('new-trip-id').value = '';
    document.getElementById('new-trip-date').value = '';
    document.getElementById('new-trip-cost-date').value = '';
    document.getElementById('new-trip-vehicle').value = '';
    document.getElementById('new-trip-picker').value = '';
    document.getElementById('new-trip-priority').value = '';
    document.getElementById('new-trip-loading-bay').value = '';
    document.getElementById('new-trip-notes').value = '';
}

// Create New Trip
window.createNewTrip = async function() {
    console.log('[New Trip] Creating trip...');

    // Get form values
    const tripDate = document.getElementById('new-trip-date').value;
    const costDate = document.getElementById('new-trip-cost-date').value;
    const vehicle = document.getElementById('new-trip-vehicle').value;
    const picker = document.getElementById('new-trip-picker').value;
    const priority = document.getElementById('new-trip-priority').value;
    const loadingBay = document.getElementById('new-trip-loading-bay').value;
    const notes = document.getElementById('new-trip-notes').value;

    // Validate required fields
    if (!tripDate) {
        alert('Please select a trip date');
        return;
    }

    if (!costDate) {
        alert('Please select a trip cost date');
        return;
    }

    if (!vehicle) {
        alert('Please select a vehicle');
        return;
    }

    if (!picker) {
        alert('Please select a picker');
        return;
    }

    if (!priority) {
        alert('Please select a priority');
        return;
    }

    if (!loadingBay) {
        alert('Please select a loading bay');
        return;
    }

    // Prepare trip data
    const tripData = {
        trip_date: tripDate,
        cost_date: costDate,
        vehicle: vehicle,
        picker: parseInt(picker),
        priority: parseInt(priority),
        loading_bay: loadingBay,
        notes: notes || ''
    };

    console.log('[New Trip] Trip data:', tripData);

    // Store original form values for later use
    const originalLoadingBay = loadingBay;
    const originalPriority = priority;

    // Disable create button and show loading
    const createBtn = document.getElementById('create-trip-btn');
    const originalBtnText = createBtn.innerHTML;
    createBtn.disabled = true;
    createBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Creating...';

    try {
        // Call POST API to create trip
        const CREATE_TRIP_API = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trips/create';

        if (window.chrome && window.chrome.webview) {
            // WebView2 environment - use sendMessageToCSharp for POST
            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: CREATE_TRIP_API,
                body: JSON.stringify(tripData)
            }, function(error, data) {
                createBtn.disabled = false;
                createBtn.innerHTML = originalBtnText;

                if (error) {
                    console.error('[New Trip] Error creating trip:', error);
                    alert('Error creating trip:\n' + error);
                } else {
                    try {
                        const response = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log('[New Trip] Trip created successfully:', response);

                        if (response.success) {
                            console.log('[New Trip] Trip created, navigating to trip details...');
                            closeNewTripModal();

                            // Navigate to trip details page
                            if (typeof window.openTripDetailsPage === 'function') {
                                // Prepare trip data for details page
                                const tripDetailsData = {
                                    trip_id: response.trip_id,
                                    trip_date: response.trip_date,
                                    trip_lorry: response.trip_lorry,
                                    trip_loading_bay: originalLoadingBay,
                                    trip_priority: originalPriority,
                                    vehicle: response.trip_lorry,
                                    status: 'DRAFT'
                                };
                                window.openTripDetailsPage(tripDetailsData);
                            } else {
                                alert('✅ Trip created successfully!\n\nTrip Date: ' + response.trip_date + '\nVehicle: ' + response.trip_lorry);
                            }

                            // Optionally refresh trips grid if on trip management page
                            if (typeof window.fetchTrips === 'function') {
                                window.fetchTrips();
                            }
                        } else {
                            alert('Error creating trip:\n' + (response.error || 'Unknown error'));
                        }
                    } catch (parseError) {
                        console.error('[New Trip] Error parsing response:', parseError);
                        alert('Error processing response: ' + parseError.message);
                    }
                }
            });
        } else {
            // Fallback for browser testing
            const response = await fetch(CREATE_TRIP_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tripData)
            });

            const result = await response.json();

            createBtn.disabled = false;
            createBtn.innerHTML = originalBtnText;

            if (response.ok && result.success) {
                console.log('[New Trip] Trip created, navigating to trip details...');
                closeNewTripModal();

                // Navigate to trip details page
                if (typeof window.openTripDetailsPage === 'function') {
                    // Prepare trip data for details page
                    const tripDetailsData = {
                        trip_id: result.trip_id,
                        trip_date: result.trip_date,
                        trip_lorry: result.trip_lorry,
                        trip_loading_bay: originalLoadingBay,
                        trip_priority: originalPriority,
                        vehicle: result.trip_lorry,
                        status: 'DRAFT'
                    };
                    window.openTripDetailsPage(tripDetailsData);
                } else {
                    alert('✅ Trip created successfully!\n\nTrip Date: ' + result.trip_date + '\nVehicle: ' + result.trip_lorry);
                }

                // Optionally refresh trips grid
                if (typeof window.fetchTrips === 'function') {
                    window.fetchTrips();
                }
            } else {
                console.error('[New Trip] Error response:', result);
                alert('Error creating trip:\n' + (result.error || 'Unknown error'));
            }
        }
    } catch (error) {
        console.error('[New Trip] Exception creating trip:', error);
        createBtn.disabled = false;
        createBtn.innerHTML = originalBtnText;
        alert('Error creating trip:\n' + error.message);
    }
};

// ============================================================================
// HANDLE TRIP ID SUBMIT FROM CO-PILOT
// ============================================================================

window.handleTripIdSubmit = async function() {
    const tripIdInput = document.getElementById('copilot-trip-id-input');
    const tripId = tripIdInput?.value.trim();

    if (!tripId) {
        alert('Please enter a Trip ID');
        return;
    }

    console.log('[Co-Pilot] Fetching trip details for ID:', tripId);

    // Add loading message
    addChatMessage('user', `View trip details for Trip ID: ${tripId}`);
    addChatMessage('assistant', '🔍 Loading trip details...');

    try {
        // Call API to get trip details
        const currentInstance = sessionStorage.getItem('loggedInInstance') || 'PROD';
        const apiUrl = `/trip/s2vdetails/${tripId}`;

        const response = await callApexAPINew(apiUrl, 'GET', null, currentInstance);

        if (response && response.items && response.items.length > 0) {
            const tripData = response.items[0];
            console.log('[Co-Pilot] Trip data received:', tripData);

            // Show success message
            const lastMessage = document.querySelector('.copilot-message-assistant:last-child .copilot-message-bubble');
            if (lastMessage) {
                lastMessage.textContent = `✅ Trip found! Opening Trip Details dialog...`;
            }

            // Close copilot panel
            toggleCopilot();

            // Open trip details in dialog
            setTimeout(() => {
                showTripDetailsDialog(tripData);
            }, 300);
        } else {
            const lastMessage = document.querySelector('.copilot-message-assistant:last-child .copilot-message-bubble');
            if (lastMessage) {
                lastMessage.textContent = `❌ Trip ID ${tripId} not found. Please check the ID and try again.`;
            }
        }
    } catch (error) {
        console.error('[Co-Pilot] Error fetching trip details:', error);
        const lastMessage = document.querySelector('.copilot-message-assistant:last-child .copilot-message-bubble');
        if (lastMessage) {
            lastMessage.textContent = `❌ Error loading trip details: ${error.message}`;
        }
    }
};

// ============================================================================
// SHOW TRIP DETAILS DIALOG
// ============================================================================

window.showTripDetailsDialog = function(tripData) {
    console.log('[Co-Pilot] Showing trip details dialog for:', tripData);

    // Create dialog overlay
    const dialogOverlay = document.createElement('div');
    dialogOverlay.id = 'trip-details-dialog-overlay';
    dialogOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 20000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Create dialog container
    const dialogContainer = document.createElement('div');
    dialogContainer.style.cssText = `
        background: white;
        width: 95%;
        max-width: 1400px;
        height: 90%;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    `;

    // Dialog header
    const dialogHeader = document.createElement('div');
    dialogHeader.style.cssText = `
        padding: 1.5rem;
        border-bottom: 2px solid #f0f0f0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    `;
    dialogHeader.innerHTML = `
        <h3 style="margin: 0; font-size: 20px; color: white; display: flex; align-items: center; gap: 0.5rem;">
            <i class="fas fa-truck"></i>
            Trip Details - Trip #${tripData.trip_id || tripData.TRIP_ID || '-'}
        </h3>
        <button onclick="closeTripDetailsDialog()" style="background: rgba(255,255,255,0.2); border: none; font-size: 28px; cursor: pointer; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">×</button>
    `;

    // Dialog body
    const dialogBody = document.createElement('div');
    dialogBody.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 1.5rem;
    `;

    // Add trip header info
    dialogBody.innerHTML = `
        <div style="background: white; border-radius: 8px; margin-bottom: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-left: 4px solid #667eea;">
            <div style="padding: 1rem 1.5rem; background: #f9fafb;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <div style="width: 40px; height: 40px; background: #dbeafe; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <i class="fas fa-calendar" style="color: #2563eb; font-size: 16px;"></i>
                        </div>
                        <div>
                            <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Trip Date</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1f2937;">${tripData.trip_date || tripData.TRIP_DATE || '-'}</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <div style="width: 40px; height: 40px; background: #fef3c7; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <i class="fas fa-truck" style="color: #d97706; font-size: 16px;"></i>
                        </div>
                        <div>
                            <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Vehicle</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1f2937;">${tripData.trip_lorry || tripData.TRIP_LORRY || '-'}</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <div style="width: 40px; height: 40px; background: #dcfce7; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <i class="fas fa-warehouse" style="color: #16a34a; font-size: 16px;"></i>
                        </div>
                        <div>
                            <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Loading Bay</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1f2937;">${tripData.trip_loading_bay || tripData.TRIP_LOADING_BAY || '-'}</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <div style="width: 40px; height: 40px; background: #fce7f3; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <i class="fas fa-flag" style="color: #db2777; font-size: 16px;"></i>
                        </div>
                        <div>
                            <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Priority</div>
                            <div style="font-size: 15px; font-weight: 600; color: #1f2937;">${tripData.trip_priority || tripData.TRIP_PRIORITY || '-'}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Orders Grid -->
        <div class="grid-container">
            <div style="padding: 1rem 1.5rem; background: white; border-bottom: 2px solid #f0f0f0;">
                <div class="grid-title">Trip Orders</div>
            </div>
            <div id="trip-details-dialog-grid" style="height: 450px;"></div>
        </div>
    `;

    // Assemble dialog
    dialogContainer.appendChild(dialogHeader);
    dialogContainer.appendChild(dialogBody);
    dialogOverlay.appendChild(dialogContainer);
    document.body.appendChild(dialogOverlay);

    // Initialize grid with trip orders
    initializeTripDetailsDialogGrid(tripData);
};

// Close trip details dialog
window.closeTripDetailsDialog = function() {
    const overlay = document.getElementById('trip-details-dialog-overlay');
    if (overlay) {
        overlay.remove();
    }
};

// Initialize grid in dialog
function initializeTripDetailsDialogGrid(tripData) {
    try {
        // Fetch orders for this trip
        const tripId = tripData.trip_id || tripData.TRIP_ID;
        const currentInstance = sessionStorage.getItem('loggedInInstance') || 'PROD';

        callApexAPINew(`/trip/orders/${tripId}`, 'GET', null, currentInstance)
            .then(response => {
                const orders = response.items || [];
                console.log('[Trip Details Dialog] Orders:', orders);

                $('#trip-details-dialog-grid').dxDataGrid({
                    dataSource: orders,
                    showBorders: true,
                    showRowLines: true,
                    showColumnLines: true,
                    rowAlternationEnabled: true,
                    columnAutoWidth: true,
                    allowColumnReordering: true,
                    allowColumnResizing: true,
                    hoverStateEnabled: true,
                    filterRow: {
                        visible: true,
                        applyFilter: 'auto'
                    },
                    searchPanel: {
                        visible: true,
                        width: 240,
                        placeholder: 'Search orders...'
                    },
                    paging: {
                        pageSize: 20
                    },
                    columns: [
                        {
                            dataField: 'source_order_number',
                            caption: 'Order Number',
                            width: 130,
                            cssClass: 'small-font-grid'
                        },
                        {
                            dataField: 'account_number',
                            caption: 'Account',
                            width: 100,
                            cssClass: 'small-font-grid'
                        },
                        {
                            dataField: 'account_name',
                            caption: 'Customer',
                            width: 200,
                            cssClass: 'small-font-grid'
                        },
                        {
                            dataField: 'order_date',
                            caption: 'Order Date',
                            width: 110,
                            dataType: 'date',
                            format: 'yyyy-MM-dd',
                            cssClass: 'small-font-grid'
                        },
                        {
                            dataField: 'order_type_code',
                            caption: 'Order Type',
                            width: 90,
                            cssClass: 'small-font-grid'
                        },
                        {
                            dataField: 'pick_confirm_st',
                            caption: 'Pick Status',
                            width: 80,
                            alignment: 'center',
                            calculateCellValue: function(rowData) {
                                return rowData.PICK_CONFIRM_ST || rowData.pick_confirm_st || '';
                            }
                        },
                        {
                            dataField: 'ship_confirm_st',
                            caption: 'Ship Status',
                            width: 80,
                            alignment: 'center',
                            calculateCellValue: function(rowData) {
                                return rowData.SHIP_CONFIRM_ST || rowData.ship_confirm_st || '';
                            }
                        }
                    ]
                }).dxDataGrid('instance');
            })
            .catch(error => {
                console.error('[Trip Details Dialog] Error loading orders:', error);
                alert('Error loading trip orders: ' + error.message);
            });
    } catch (error) {
        console.error('[Trip Details Dialog] Error initializing grid:', error);
    }
}

console.log('[Co-Pilot] ✅ New Trip functions loaded');

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
            case 'searchTransaction':
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
                    } else if (action === 'searchTransaction') {
                        response = '🔍 Please enter the Transaction Number:';

                        // Add input field for transaction number with type options
                        setTimeout(() => {
                            const chatMessages = document.getElementById('copilot-chat-messages');
                            const inputDiv = document.createElement('div');
                            inputDiv.className = 'copilot-message copilot-message-assistant';
                            inputDiv.innerHTML = `
                                <div class="copilot-message-avatar">
                                    <i class="fas fa-robot"></i>
                                </div>
                                <div class="copilot-message-bubble">
                                    <div style="margin-bottom: 0.5rem; font-weight: 600;">Enter Transaction Number:</div>
                                    <input type="text" id="copilot-transaction-number-input"
                                           placeholder="e.g., 12345"
                                           style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; margin-bottom: 0.75rem;">
                                    <div style="margin-bottom: 0.5rem; font-weight: 600;">Select Transaction Type:</div>
                                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                        <button onclick="handleTransactionSearch('S2V')"
                                                style="flex: 1; padding: 0.6rem 1rem; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 0.3rem; transition: background 0.2s;"
                                                onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
                                            <i class="fas fa-truck"></i> Search S2V
                                        </button>
                                        <button onclick="handleTransactionSearch('Order')"
                                                style="flex: 1; padding: 0.6rem 1rem; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 0.3rem; transition: background 0.2s;"
                                                onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
                                            <i class="fas fa-box"></i> Search Order
                                        </button>
                                    </div>
                                </div>
                            `;
                            chatMessages.appendChild(inputDiv);
                            chatMessages.scrollTop = chatMessages.scrollHeight;

                            // Focus on input
                            setTimeout(() => {
                                document.getElementById('copilot-transaction-number-input')?.focus();
                            }, 100);
                        }, 100);
                    } else if (action === 'printTrip') {
                        response = '📄 Please enter the Trip ID:';

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
                                    <div style="margin-bottom: 0.5rem; font-weight: 600;">Enter Trip ID:</div>
                                    <input type="text" id="copilot-print-trip-id-input"
                                           placeholder="e.g., 1719"
                                           style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; margin-bottom: 0.75rem;"
                                           onkeypress="if(event.key==='Enter') handlePrintTripSubmit()">
                                    <button onclick="handlePrintTripSubmit()"
                                            style="width: 100%; padding: 0.6rem 1rem; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 0.3rem; transition: background 0.2s;"
                                            onmouseover="this.style.background='#5568d3'" onmouseout="this.style.background='#667eea'">
                                        <i class="fas fa-truck"></i> View Trip Details
                                    </button>
                                </div>
                            `;
                            chatMessages.appendChild(inputDiv);
                            chatMessages.scrollTop = chatMessages.scrollHeight;

                            // Focus on input
                            setTimeout(() => {
                                document.getElementById('copilot-print-trip-id-input')?.focus();
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
    window.addChatMessage = function(role, content) {
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
    };

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
// HANDLE TRANSACTION SEARCH FROM CO-PILOT
// ============================================================================

window.handleTransactionSearch = function(type) {
    const transactionInput = document.getElementById('copilot-transaction-number-input');
    const transactionNumber = transactionInput?.value.trim();

    if (!transactionNumber) {
        alert('Please enter a Transaction Number');
        return;
    }

    console.log('[Co-Pilot] Searching transaction:', transactionNumber, 'Type:', type);

    // Add user message
    addChatMessage('user', `Search ${type}: ${transactionNumber}`);

    if (type === 'S2V') {
        // For S2V (Store to Van), open Store Transactions dialog
        addChatMessage('assistant', `✅ Opening Store Transactions for: ${transactionNumber}`);

        // Close copilot panel
        toggleCopilot();

        // Open Store Transactions dialog with the transaction number
        setTimeout(() => {
            // Create a rowData object with the transaction number
            const rowData = {
                ORDER_NUMBER: transactionNumber,
                order_number: transactionNumber,
                ORDER_TYPE: 'S2V',
                order_type: 'S2V'
            };

            // Call the existing openStoreTransactionsDialog function from app.js
            if (typeof window.openStoreTransactionsDialog === 'function') {
                window.openStoreTransactionsDialog(rowData);
            } else {
                alert('Store Transactions dialog function not found. Please ensure app.js is loaded.');
            }
        }, 300);

    } else if (type === 'Order') {
        // For regular Order search
        addChatMessage('assistant', `🔍 Order search for: ${transactionNumber}\n\n(Implementation coming soon)`);
    }
};

// ============================================================================
// HANDLE PRINT TRIP SUBMIT FROM CO-PILOT
// ============================================================================

window.handlePrintTripSubmit = async function() {
    const tripIdInput = document.getElementById('copilot-print-trip-id-input');
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
        // Call API to get trip details - SAME AS VIEW DETAILS BUTTON
        const currentInstance = sessionStorage.getItem('loggedInInstance') || 'PROD';
        const GET_TRIP_DETAILS_API = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/${tripId}?P_INSTANCE_NAME=${currentInstance}`;

        console.log('[Co-Pilot] ============================================');
        console.log('[Co-Pilot] Calling GETTRIPDETAILS API:', GET_TRIP_DETAILS_API);
        console.log('[Co-Pilot] Trip ID:', tripId);
        console.log('[Co-Pilot] Instance:', currentInstance);
        console.log('[Co-Pilot] ============================================');

        // Use the same method as View Details button - sendMessageToCSharp
        const response = await new Promise((resolve, reject) => {
            if (window.chrome && window.chrome.webview) {
                // WebView2 environment - use C# backend (same as View Details button)
                sendMessageToCSharp({
                    action: 'executeGet',
                    fullUrl: GET_TRIP_DETAILS_API
                }, function(error, data) {
                    if (error) {
                        console.error('[Co-Pilot] Error from C#:', error);
                        reject(new Error(error));
                    } else {
                        try {
                            const result = typeof data === 'string' ? JSON.parse(data) : data;
                            console.log('[Co-Pilot] Trip details response:', result);
                            resolve(result);
                        } catch (parseError) {
                            console.error('[Co-Pilot] Parse error:', parseError);
                            reject(parseError);
                        }
                    }
                });
            } else {
                // Fallback for browser testing
                fetch(GET_TRIP_DETAILS_API)
                    .then(response => response.json())
                    .then(result => {
                        console.log('[Co-Pilot] Trip details response (fetch):', result);
                        resolve(result);
                    })
                    .catch(error => {
                        console.error('[Co-Pilot] Fetch error:', error);
                        reject(error);
                    });
            }
        });

        console.log('[Co-Pilot] Final response object:', response);

        if (response && response.items && response.items.length > 0) {
            // Pass the entire items array, just like View Details button does
            const tripData = response.items;
            console.log('[Co-Pilot] Trip data received (', tripData.length, 'records):', tripData);

            // Show success message
            const lastMessage = document.querySelector('.copilot-message-assistant:last-child .copilot-message-bubble');
            if (lastMessage) {
                lastMessage.textContent = `✅ Trip found! Opening Trip Details dialog...`;
            }

            // Close copilot panel
            toggleCopilot();

            // Open trip details in dialog - using the Trip Details Page content
            setTimeout(() => {
                showTripDetailsPageDialog(tripId, tripData);
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
// SHOW TRIP DETAILS PAGE AS DIALOG
// ============================================================================

window.showTripDetailsPageDialog = function(tripId, tripData) {
    console.log('[Co-Pilot] Showing Trip Details Page as dialog for trip:', tripId, 'with', tripData.length, 'records');

    // Calculate KPI statistics (same as openTripDetailsWithData in app.js)
    const firstRecord = tripData[0];
    const totalOrders = tripData.length;
    const uniqueCustomers = new Set(tripData.map(t => t.account_name || t.ACCOUNT_NAME || t.CUSTOMER_NAME).filter(x => x)).size;
    const uniqueProducts = new Set(tripData.map(t => t.PRODUCT_NAME || t.item_name || t.ITEM_NAME).filter(x => x)).size;
    const totalQuantity = tripData.reduce((sum, t) => sum + (parseFloat(t.QUANTITY || t.quantity || 0)), 0);
    const totalWeight = tripData.reduce((sum, t) => sum + (parseFloat(t.WEIGHT || t.weight || 0)), 0);
    const priority = firstRecord.TRIP_PRIORITY || firstRecord.trip_priority || firstRecord.PRIORITY || 'Medium';
    const tripDate = firstRecord.TRIP_DATE || firstRecord.trip_date || '-';
    const lorryNumber = firstRecord.TRIP_LORRY || firstRecord.trip_lorry || '-';

    // Create dialog overlay
    const dialogOverlay = document.createElement('div');
    dialogOverlay.id = 'trip-details-page-dialog-overlay';
    dialogOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        z-index: 20000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Create dialog container with the EXACT SAME layout as the tab version
    const dialogContainer = document.createElement('div');
    dialogContainer.style.cssText = `
        background: white;
        width: 95%;
        max-width: 1600px;
        height: 95%;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
    `;

    // Add close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '×';
    closeButton.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(220, 53, 69, 0.9);
        border: none;
        font-size: 32px;
        cursor: pointer;
        color: white;
        width: 45px;
        height: 45px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    closeButton.onclick = closeTripDetailsPageDialog;

    // Build the EXACT SAME HTML as the tab version
    const contentWrapper = document.createElement('div');
    contentWrapper.style.cssText = 'padding: 1rem; overflow-y: auto; height: 100%;';
    contentWrapper.innerHTML = `
        <!-- Trip Summary Section -->
        <div style="background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 1rem; overflow: hidden;">
            <div onclick="toggleTripSummaryDialog()" style="padding: 1rem 1.25rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div style="width: 40px; height: 40px; background: rgba(255,255,255,0.2); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                        <i class="fas fa-route" style="color: white; font-size: 1.2rem;"></i>
                    </div>
                    <div>
                        <h2 style="font-size: 1.1rem; font-weight: 700; color: white; margin: 0;">Trip: ${tripId}</h2>
                        <p style="color: rgba(255,255,255,0.9); font-size: 0.75rem; margin: 0.2rem 0 0 0;">Trip Summary & Statistics</p>
                    </div>
                </div>
                <i class="fas fa-chevron-down" id="summary-icon-dialog" style="color: white; font-size: 1rem; transition: transform 0.3s ease;"></i>
            </div>

            <div id="trip-summary-dialog" style="padding: 0.75rem; background: linear-gradient(to bottom, #f8f9fc 0%, #ffffff 100%);">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem;">
                    <!-- Trip Date Card -->
                    <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(99, 102, 241, 0.1); border-left: 3px solid #6366f1;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                            <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #6366f1, #4f46e5); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-calendar-alt" style="color: white; font-size: 0.7rem;"></i>
                            </div>
                            <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Trip Date</div>
                        </div>
                        <div style="font-size: 0.85rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${tripDate}</div>
                    </div>

                    <!-- Lorry Number Card -->
                    <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(16, 185, 129, 0.1); border-left: 3px solid #10b981;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                            <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #10b981, #059669); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-truck" style="color: white; font-size: 0.7rem;"></i>
                            </div>
                            <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Lorry</div>
                        </div>
                        <div style="font-size: 0.85rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${lorryNumber}</div>
                    </div>

                    <!-- Total Orders Card -->
                    <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(245, 158, 11, 0.1); border-left: 3px solid #f59e0b;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                            <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #f59e0b, #d97706); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-box" style="color: white; font-size: 0.7rem;"></i>
                            </div>
                            <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Orders</div>
                        </div>
                        <div style="font-size: 1.0rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${totalOrders}</div>
                    </div>

                    <!-- Customers Card -->
                    <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(59, 130, 246, 0.1); border-left: 3px solid #3b82f6;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                            <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #3b82f6, #2563eb); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-users" style="color: white; font-size: 0.7rem;"></i>
                            </div>
                            <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Customers</div>
                        </div>
                        <div style="font-size: 1.0rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${uniqueCustomers}</div>
                    </div>

                    <!-- Total Quantity Card -->
                    <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(139, 92, 246, 0.1); border-left: 3px solid #8b5cf6;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                            <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-cubes" style="color: white; font-size: 0.7rem;"></i>
                            </div>
                            <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Quantity</div>
                        </div>
                        <div style="font-size: 1.0rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${totalQuantity.toLocaleString()}</div>
                    </div>

                    <!-- Total Weight Card -->
                    <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(236, 72, 153, 0.1); border-left: 3px solid #ec4899;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                            <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #ec4899, #db2777); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-weight" style="color: white; font-size: 0.7rem;"></i>
                            </div>
                            <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Weight</div>
                        </div>
                        <div style="font-size: 0.85rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${totalWeight.toFixed(2)} kg</div>
                    </div>

                    <!-- Products Card -->
                    <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(20, 184, 166, 0.1); border-left: 3px solid #14b8a6;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                            <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #14b8a6, #0d9488); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-boxes" style="color: white; font-size: 0.7rem;"></i>
                            </div>
                            <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Products</div>
                        </div>
                        <div style="font-size: 1.0rem; font-weight: 800; color: #1e293b; margin-left: 2.15rem;">${uniqueProducts}</div>
                    </div>

                    <!-- Priority Card -->
                    <div style="background: white; padding: 0.65rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(239, 68, 68, 0.1); border-left: 3px solid ${priority.toLowerCase().includes('high') ? '#ef4444' : priority.toLowerCase().includes('low') ? '#22c55e' : '#f59e0b'};">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                            <div style="width: 28px; height: 28px; background: linear-gradient(135deg, ${priority.toLowerCase().includes('high') ? '#ef4444, #dc2626' : priority.toLowerCase().includes('low') ? '#22c55e, #16a34a' : '#f59e0b, #d97706'}); border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-flag" style="color: white; font-size: 0.7rem;"></i>
                            </div>
                            <div style="color: #64748b; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Priority</div>
                        </div>
                        <div style="font-size: 0.85rem; font-weight: 800; color: ${priority.toLowerCase().includes('high') ? '#ef4444' : priority.toLowerCase().includes('low') ? '#22c55e' : '#f59e0b'}; margin-left: 2.15rem;">${priority}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Orders Section -->
        <div style="background: white; padding: 0.75rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="font-size: 0.85rem; font-weight: 600; margin: 0; color: var(--gray-800);">
                    <i class="fas fa-table" style="font-size: 0.75rem;"></i> Order Details
                </h3>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <div style="color: var(--gray-600); font-size: 0.7rem;">
                        <i class="fas fa-info-circle" style="font-size: 0.65rem;"></i> Showing ${totalOrders} orders
                    </div>
                    <button class="btn btn-info" onclick="refreshTripDetails('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                    <button class="btn btn-secondary" onclick="assignPickerToTrip('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                        <i class="fas fa-user-check"></i> Assign Picker
                    </button>
                    <button class="btn btn-success" onclick="allocateLotsForS2V('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                        <i class="fas fa-boxes"></i> Allocate Lots for S2V
                    </button>
                    <button class="btn btn-warning" onclick="pickReleaseAll('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                        <i class="fas fa-truck-loading"></i> Pick Release All
                    </button>
                    <button class="btn btn-primary" onclick="openAddOrdersModalForTrip('${tripId}')" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                        <i class="fas fa-plus"></i> Add Orders
                    </button>
                </div>
            </div>
            <div id="trip-dialog-grid" style="height: 500px;"></div>
        </div>
    `;

    // Assemble dialog
    dialogContainer.appendChild(closeButton);
    dialogContainer.appendChild(contentWrapper);
    dialogOverlay.appendChild(dialogContainer);
    document.body.appendChild(dialogOverlay);

    // Initialize grid after DOM is ready
    setTimeout(() => {
        initializeTripDialogGrid(tripId, tripData);
    }, 100);
};

// Close trip details page dialog
window.closeTripDetailsPageDialog = function() {
    const overlay = document.getElementById('trip-details-page-dialog-overlay');
    if (overlay) {
        overlay.remove();
    }
};

// Toggle trip summary section in dialog
window.toggleTripSummaryDialog = function() {
    const summaryDiv = document.getElementById('trip-summary-dialog');
    const icon = document.getElementById('summary-icon-dialog');

    if (summaryDiv && icon) {
        if (summaryDiv.style.display === 'none') {
            summaryDiv.style.display = 'block';
            icon.style.transform = 'rotate(0deg)';
        } else {
            summaryDiv.style.display = 'none';
            icon.style.transform = 'rotate(-90deg)';
        }
    }
};

// Initialize trip dialog grid with data (matching app.js grid structure)
function initializeTripDialogGrid(tripId, tripData) {
    try {
        console.log('[Co-Pilot] Initializing trip dialog grid for trip:', tripId, 'with', tripData.length, 'records');

        const gridContainer = $('#trip-dialog-grid');
        if (!gridContainer || gridContainer.length === 0) {
            console.error('[Co-Pilot] Grid container not found: #trip-dialog-grid');
            return;
        }

        if (tripData.length === 0) {
            gridContainer.html('<div style="padding:2rem;text-align:center;color:#64748b;">No data found</div>');
            return;
        }

        // Build columns dynamically from first record (same as app.js)
        const first = tripData[0];
        const columns = Object.keys(first).map(key => {
            let col = { dataField: key, caption: key.replace(/_/g, ' ') };

            if (key === 'LINE_STATUS') {
                col.cellTemplate = (container, options) => {
                    const val = options.value || 'Unknown';
                    const safeClass = String(val).toLowerCase()
                        .replace(/,/g, ' ')
                        .replace(/\s+/g, '-')
                        .replace(/[^a-z0-9-]/g, '')
                        .replace(/-+/g, '-')
                        .replace(/^-|-$/g, '') || 'unknown';
                    $(container).html(`<span class="status-badge status-${safeClass}">${val}</span>`);
                };
            } else if (key === 'PICK_CONFIRM_ST' || key === 'pick_confirm_st' || key === 'SHIP_CONFIRM_ST' || key === 'ship_confirm_st') {
                col.alignment = 'center';
                col.caption = key.includes('PICK') || key.includes('pick') ? 'Pick Status' : 'Ship Status';
                // Show raw data value without icons
            } else if (key.endsWith('_WEIGHT')) {
                col.format = { type: 'fixedPoint', precision: 2 };
                col.alignment = 'right';
            } else if (key.endsWith('_ITEMS') || !isNaN(Number(first[key]))) {
                col.format = { type: 'fixedPoint', precision: 0 };
                col.alignment = 'right';
            }
            return col;
        });

        // Add Actions column at the beginning (EXACT SAME as app.js)
        columns.unshift({
            caption: 'Actions',
            width: 180,
            alignment: 'center',
            allowFiltering: false,
            allowSorting: false,
            cellTemplate: function(container, options) {
                const rowData = options.data;
                const instanceName = rowData.instance_name || rowData.INSTANCE_NAME || rowData.instance || rowData.INSTANCE || 'TEST';
                const orderType = rowData.ORDER_TYPE || rowData.order_type || rowData.ORDER_TYPE_CODE || rowData.order_type_code || '';
                const tripIdFromRow = rowData.TRIP_ID || rowData.trip_id || '';
                const tripDateFromRow = rowData.TRIP_DATE || rowData.trip_date || '';

                $(container).html(`
                    <div style="display: flex; gap: 0.5rem; justify-content: center;">
                        <button class="icon-btn" onclick="printStoreTransaction('${rowData.ORDER_NUMBER || rowData.order_number}', '${instanceName}', '${orderType}', '${tripIdFromRow}', '${tripDateFromRow}')" title="Print Store Transaction">
                            <i class="fas fa-print" style="color: #8b5cf6;"></i>
                        </button>
                        <button class="icon-btn" onclick="unassignPicker('${tripId}', '${rowData.ORDER_NUMBER || rowData.order_number}')" title="Unassign Picker">
                            <i class="fas fa-user-times" style="color: #ef4444;"></i>
                        </button>
                        <button class="icon-btn" onclick="pickRelease('${tripId}', '${rowData.ORDER_NUMBER || rowData.order_number}')" title="Pick Release">
                            <i class="fas fa-check-circle" style="color: #10b981;"></i>
                        </button>
                        <button class="icon-btn" onclick='editTripOrder(${JSON.stringify(rowData)})' title="Edit">
                            <i class="fas fa-edit" style="color: #3b82f6;"></i>
                        </button>
                        <button class="icon-btn" onclick="deleteTripOrder('${tripId}', '${rowData.ORDER_NUMBER || rowData.order_number}')" title="Delete">
                            <i class="fas fa-trash" style="color: #f59e0b;"></i>
                        </button>
                    </div>
                `);
            }
        });

        // Initialize DevExpress grid (EXACT SAME configuration as app.js)
        gridContainer.dxDataGrid({
            dataSource: tripData,
            columns: columns,
            showBorders: true,
            columnAutoWidth: true,
            scrolling: { useNative: true, showScrollbar: 'always' },
            filterRow: { visible: true },
            headerFilter: { visible: true },
            searchPanel: { visible: true, placeholder: "Search..." },
            paging: { pageSize: 20 },
            pager: { showPageSizeSelector: true, allowedPageSizes: [10, 20, 50, 'all'] },
            allowColumnReordering: true,
            allowColumnResizing: true,
            columnResizingMode: 'widget',
            rowAlternationEnabled: true,
            selection: {
                mode: 'multiple',
                showCheckBoxesMode: 'always'
            },
            export: {
                enabled: true,
                allowExportSelectedData: true,
                fileName: `Trip_${tripId}`
            },
            height: '100%'
        });

        console.log('[Co-Pilot] Trip dialog grid initialized successfully');

    } catch (error) {
        console.error('[Co-Pilot] Error initializing trip dialog grid:', error);
    }
}

// ============================================================================
// SHOW TRIP DETAILS DIALOG (OLD VERSION - KEPT FOR BACKWARD COMPATIBILITY)
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

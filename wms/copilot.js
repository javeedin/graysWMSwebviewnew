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
                        response = '📄 I can print trip documents. Please provide:\n\n• Trip ID\n• Document type (Trip Sheet / Delivery Notes / All)\n\n(Full implementation coming soon)';
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

console.log('[Co-Pilot] ✅ New Trip functions loaded');

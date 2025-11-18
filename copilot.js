// ============================================================================
// WMS CO-PILOT ASSISTANT
// ============================================================================

console.log('[Co-Pilot] Initializing WMS Co-Pilot...');

// ============================================================================
// TOGGLE CO-PILOT PANEL
// ============================================================================

window.toggleCopilot = function() {
    console.log('[Co-Pilot] Toggling panel...');

    const panel = document.getElementById('copilot-panel');
    const overlay = document.getElementById('copilot-overlay');
    const fab = document.getElementById('copilot-fab');

    const isActive = panel.classList.contains('active');

    if (isActive) {
        // Close panel
        panel.classList.remove('active');
        overlay.classList.remove('active');
        fab.style.transform = 'scale(1) rotate(0deg)';
    } else {
        // Open panel
        panel.classList.add('active');
        overlay.classList.add('active');
        fab.style.transform = 'scale(0.9) rotate(180deg)';
    }
};

// ============================================================================
// CO-PILOT ACTIONS
// ============================================================================

window.copilotAction = function(action) {
    console.log('[Co-Pilot] Action triggered:', action);

    switch (action) {
        case 'createTrip':
            createNewTrip();
            break;
        case 'addToTrip':
            addOrderToTrip();
            break;
        case 'printOrder':
            printSingleOrder();
            break;
        case 'printTrip':
            printTripDocuments();
            break;
        case 'autoSchedule':
            autoScheduleTrips();
            break;
        case 'optimizeRoute':
            optimizeDeliveryRoute();
            break;
        case 'viewPending':
            viewPendingOrders();
            break;
        case 'viewTrip':
            viewTripDetails();
            break;
        default:
            console.warn('[Co-Pilot] Unknown action:', action);
            alert('This feature is coming soon!');
    }
};

// ============================================================================
// CO-PILOT ACTION IMPLEMENTATIONS
// ============================================================================

function createNewTrip() {
    console.log('[Co-Pilot] Creating new trip...');

    // Close co-pilot panel
    toggleCopilot();

    // Navigate to Trip Management page
    const tripManagementTab = document.querySelector('.menu-item[data-page="trip-management"]');
    if (tripManagementTab) {
        tripManagementTab.click();
    }

    // Show create trip dialog
    setTimeout(() => {
        alert('🚚 Create New Trip\n\nPlease fill in the trip details:\n- Trip ID\n- Lorry Number\n- Trip Date\n- Delivery Route\n\n(Full form implementation coming soon)');
    }, 300);
}

function addOrderToTrip() {
    console.log('[Co-Pilot] Add order to trip...');

    toggleCopilot();

    const tripManagementTab = document.querySelector('.menu-item[data-page="trip-management"]');
    if (tripManagementTab) {
        tripManagementTab.click();
    }

    setTimeout(() => {
        alert('📦 Add Order to Trip\n\nPlease provide:\n- Order Number\n- Trip ID (destination)\n\n(Full form implementation coming soon)');
    }, 300);
}

function printSingleOrder() {
    console.log('[Co-Pilot] Print single order...');

    const orderNumber = prompt('🖨️ Print Order\n\nEnter Order Number:');

    if (orderNumber && orderNumber.trim() !== '') {
        console.log('[Co-Pilot] Printing order:', orderNumber);

        // Check if we have trip data loaded
        if (window.currentFullData && window.currentFullData.length > 0) {
            // Find the order in loaded data
            const order = window.currentFullData.find(o =>
                (o.ORDER_NUMBER || o.order_number) === orderNumber.trim()
            );

            if (order) {
                const tripId = order.TRIP_ID || order.trip_id || 'Unknown';
                const tripDate = order.ORDER_DATE || order.order_date || '';

                alert(`✅ Found order ${orderNumber}\n\nTrip: ${tripId}\nDate: ${tripDate}\n\nPrinting will start...`);

                // Call print function if it exists
                if (typeof downloadOrderPdf === 'function') {
                    downloadOrderPdf(orderNumber, tripId, tripDate);
                }
            } else {
                alert(`❌ Order ${orderNumber} not found in loaded data.\n\nPlease fetch trips first from Trip Management.`);
            }
        } else {
            alert('❌ No trip data loaded.\n\nPlease go to Trip Management and fetch trips first.');
        }
    }

    toggleCopilot();
}

function printTripDocuments() {
    console.log('[Co-Pilot] Print trip documents...');

    const tripId = prompt('🖨️ Print Trip Documents\n\nEnter Trip ID:');

    if (tripId && tripId.trim() !== '') {
        console.log('[Co-Pilot] Printing trip:', tripId);

        if (window.currentFullData && window.currentFullData.length > 0) {
            // Find all orders for this trip
            const tripOrders = window.currentFullData.filter(o =>
                (o.TRIP_ID || o.trip_id || '').toString().toLowerCase() === tripId.trim().toLowerCase()
            );

            if (tripOrders.length > 0) {
                alert(`✅ Found ${tripOrders.length} orders in Trip ${tripId}\n\nPrinting all documents...`);

                // Print all orders in this trip
                tripOrders.forEach((order, index) => {
                    setTimeout(() => {
                        const orderNumber = order.ORDER_NUMBER || order.order_number;
                        const tripDate = order.ORDER_DATE || order.order_date || '';
                        console.log(`[Co-Pilot] Printing order ${index + 1}/${tripOrders.length}:`, orderNumber);

                        if (typeof downloadOrderPdf === 'function') {
                            downloadOrderPdf(orderNumber, tripId, tripDate);
                        }
                    }, index * 1000); // Delay each print by 1 second
                });
            } else {
                alert(`❌ Trip ${tripId} not found in loaded data.\n\nPlease fetch trips first from Trip Management.`);
            }
        } else {
            alert('❌ No trip data loaded.\n\nPlease go to Trip Management and fetch trips first.');
        }
    }

    toggleCopilot();
}

function autoScheduleTrips() {
    console.log('[Co-Pilot] Auto-scheduling trips...');

    toggleCopilot();

    alert('🤖 AI Auto-Schedule\n\nThis feature will:\n- Analyze pending orders\n- Optimize by location & priority\n- Assign to available lorries\n- Consider capacity & routes\n\n(AI implementation coming soon)');
}

function optimizeDeliveryRoute() {
    console.log('[Co-Pilot] Optimizing delivery route...');

    const tripId = prompt('🗺️ Optimize Route\n\nEnter Trip ID to optimize:');

    if (tripId && tripId.trim() !== '') {
        toggleCopilot();

        alert(`🗺️ Route Optimization for Trip ${tripId}\n\nAnalyzing:\n- Customer locations\n- Traffic patterns\n- Delivery priorities\n- Time windows\n\n(Full optimization coming soon)`);
    } else {
        toggleCopilot();
    }
}

function viewPendingOrders() {
    console.log('[Co-Pilot] Viewing pending orders...');

    toggleCopilot();

    // Navigate to trip management
    const tripManagementTab = document.querySelector('.menu-item[data-page="trip-management"]');
    if (tripManagementTab) {
        tripManagementTab.click();
    }

    setTimeout(() => {
        alert('📋 Pending Orders\n\nShowing all orders not yet assigned to trips.\n\n(Filter implementation coming soon)');
    }, 300);
}

function viewTripDetails() {
    console.log('[Co-Pilot] Viewing trip details...');

    toggleCopilot();

    // Navigate to trip management
    const tripManagementTab = document.querySelector('.menu-item[data-page="trip-management"]');
    if (tripManagementTab) {
        tripManagementTab.click();
    }

    setTimeout(() => {
        const tripId = 'TRP-001'; // Sample trip
        alert(`🚚 Trip Details: ${tripId}\n\nStatus: In Progress\nLorry: LRY-105\nOrders: 12\nDeparts in: 2 hours\n\n(Full details view coming soon)`);
    }, 300);
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

document.addEventListener('keydown', function(e) {
    // Alt + C to toggle Co-Pilot
    if (e.altKey && e.key === 'c') {
        e.preventDefault();
        toggleCopilot();
        console.log('[Co-Pilot] Toggled via keyboard shortcut (Alt+C)');
    }

    // Escape to close Co-Pilot
    if (e.key === 'Escape') {
        const panel = document.getElementById('copilot-panel');
        if (panel && panel.classList.contains('active')) {
            toggleCopilot();
            console.log('[Co-Pilot] Closed via Escape key');
        }
    }
});

// ============================================================================
// INITIALIZATION
// ============================================================================

console.log('[Co-Pilot] ✅ WMS Co-Pilot initialized');
console.log('[Co-Pilot] 💡 Tip: Press Alt+C to toggle Co-Pilot');

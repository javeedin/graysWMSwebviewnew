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

        // Add to chat history
        addChatMessage('user', actionName || action);

        // Switch to chat tab to show response
        switchCopilotTab('chat');

        // Simulate processing
        setTimeout(() => {
            let response = '';

            switch(action) {
                case 'createTrip':
                    response = '🚚 I can help you create a new trip. Please provide the following details:\n\n• Trip Date\n• Lorry Number\n• Route\n• Orders to include\n\n(Full implementation coming soon)';
                    break;
                case 'addToTrip':
                    response = '📦 To add orders to an existing trip, I need:\n\n• Trip ID\n• Order numbers to add\n\n(Full implementation coming soon)';
                    break;
                case 'printOrder':
                    response = '🖨️ I can help you print orders. Please specify:\n\n• Order numbers\n• Printer to use\n\n(Full implementation coming soon)';
                    break;
                case 'printTrip':
                    response = '📄 I can print trip documents. Please provide:\n\n• Trip ID\n• Document type (Trip Sheet / Delivery Notes / All)\n\n(Full implementation coming soon)';
                    break;
                case 'autoSchedule':
                    response = '🤖 Auto-scheduling feature will:\n\n• Analyze pending orders\n• Optimize routes\n• Assign to available lorries\n• Consider delivery priorities\n\n(Full implementation coming soon)';
                    break;
                case 'optimizeRoute':
                    response = '🗺️ Route optimization will:\n\n• Minimize travel distance\n• Reduce delivery time\n• Consider traffic patterns\n• Maximize efficiency\n\n(Full implementation coming soon)';
                    break;
                default:
                    response = `Processing action: ${actionName || action}\n\n(Implementation coming soon)`;
            }

            addChatMessage('assistant', response);
        }, 500);
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

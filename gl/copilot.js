/**
 * GL Co-Pilot - Standalone AI Assistant
 * Works offline with pre-defined responses
 * Can be extended to integrate with OpenAI, Claude, Gemini, etc.
 */

class GLCopilot {
    constructor() {
        this.isOpen = false;
        this.currentContext = {
            module: 'GL',
            page: 'journal-entry',
            user: 'Admin'
        };
        this.conversationHistory = [];
        this.knowledgeBase = this.initializeKnowledgeBase();
        this.init();
    }

    init() {
        // Event listeners
        document.getElementById('copilotFab').addEventListener('click', () => this.toggle());
        document.getElementById('copilotClose').addEventListener('click', () => this.close());
        document.getElementById('copilotOverlay').addEventListener('click', () => this.close());
        document.getElementById('copilotSend').addEventListener('click', () => this.sendMessage());
        document.getElementById('copilotInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // ESC key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.isOpen = true;
        document.getElementById('copilotPanel').classList.add('show');
        document.getElementById('copilotOverlay').classList.add('show');
        document.getElementById('copilotInput').focus();

        // Hide notification badge
        document.getElementById('copilotBadge').style.display = 'none';
    }

    close() {
        this.isOpen = false;
        document.getElementById('copilotPanel').classList.remove('show');
        document.getElementById('copilotOverlay').classList.remove('show');
    }

    async sendMessage() {
        const input = document.getElementById('copilotInput');
        const message = input.value.trim();

        if (!message) return;

        // Add user message to chat
        this.addMessage('user', message);
        input.value = '';

        // Show typing indicator
        this.showTyping();

        // Get response (simulate delay for realistic feel)
        setTimeout(async () => {
            const response = await this.getResponse(message);
            this.hideTyping();
            this.addMessage('copilot', response.text, response.actions);

            // Save to history
            this.conversationHistory.push({
                user: message,
                copilot: response.text,
                timestamp: new Date(),
                context: {...this.currentContext}
            });
        }, 800 + Math.random() * 700); // Random delay between 800-1500ms
    }

    addMessage(sender, text, actions = null) {
        const chatArea = document.getElementById('copilotChat');
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${sender}`;

        const time = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let actionsHTML = '';
        if (actions && actions.length > 0) {
            actionsHTML = actions.map(action => `
                <button class="action-button" onclick="copilot.executeAction('${action.type}', ${JSON.stringify(action.data).replace(/"/g, '&quot;')})">
                    <i class="fas fa-${action.icon}"></i> ${action.label}
                </button>
            `).join('');
        }

        messageDiv.innerHTML = `
            <div class="chat-avatar">
                <i class="fas fa-${sender === 'user' ? 'user' : 'robot'}"></i>
            </div>
            <div>
                <div class="chat-bubble">
                    ${text}
                    ${actionsHTML}
                </div>
                <div class="chat-time">
                    <i class="fas fa-clock"></i>
                    ${time}
                </div>
            </div>
        `;

        chatArea.appendChild(messageDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    showTyping() {
        const chatArea = document.getElementById('copilotChat');
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typingIndicator';
        typingDiv.className = 'chat-message copilot';
        typingDiv.innerHTML = `
            <div class="chat-avatar">
                <i class="fas fa-robot"></i>
            </div>
            <div>
                <div class="chat-bubble">
                    <div class="typing-indicator">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                </div>
            </div>
        `;
        chatArea.appendChild(typingDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    hideTyping() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    async getResponse(message) {
        const lowerMessage = message.toLowerCase();

        // Check if external AI is configured
        if (window.AI_CONFIG && window.AI_CONFIG.enabled) {
            // TODO: Call external AI API (OpenAI, Claude, Gemini, etc.)
            return await this.getExternalAIResponse(message);
        }

        // Use local knowledge base
        return this.getLocalResponse(lowerMessage);
    }

    getLocalResponse(message) {
        // Intent detection
        const intents = {
            greeting: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'],
            createJournal: ['create journal', 'new journal', 'add journal', 'journal entry'],
            accountBalance: ['account balance', 'balance', 'check balance', 'account inquiry'],
            trialBalance: ['trial balance', 'run trial', 'generate trial'],
            periodStatus: ['period status', 'check period', 'period', 'open period', 'close period'],
            postJournal: ['post journal', 'post', 'submit journal'],
            help: ['help', 'how do', 'how to', 'what is', 'explain'],
            reports: ['report', 'generate report', 'run report'],
            navigation: ['go to', 'navigate', 'open', 'show me']
        };

        // Find matching intent
        for (const [intent, keywords] of Object.entries(intents)) {
            if (keywords.some(keyword => message.includes(keyword))) {
                return this.knowledgeBase[intent] || this.knowledgeBase.default;
            }
        }

        // No match found, return default
        return this.knowledgeBase.default;
    }

    initializeKnowledgeBase() {
        return {
            greeting: {
                text: "Hello! 👋 Great to see you! I'm here to help you with the General Ledger module. What would you like to do today?",
                actions: [
                    { type: 'navigate', data: { page: 'journal-entry' }, icon: 'plus-circle', label: 'Create Journal' },
                    { type: 'navigate', data: { page: 'account-inquiry' }, icon: 'calculator', label: 'Account Inquiry' }
                ]
            },
            createJournal: {
                text: "I'll help you create a journal entry! To create a journal, you'll need:<br><br>" +
                      "1. <strong>Batch Name</strong> - A unique identifier for your batch<br>" +
                      "2. <strong>Ledger</strong> - Select the appropriate ledger<br>" +
                      "3. <strong>Period</strong> - Choose the accounting period<br>" +
                      "4. <strong>Journal Source</strong> - e.g., Manual, Payables, Receivables<br>" +
                      "5. <strong>Category</strong> - e.g., Adjustment, Accrual<br><br>" +
                      "Would you like me to navigate you to the Journal Entry page?",
                actions: [
                    { type: 'navigate', data: { page: 'journal-entry' }, icon: 'arrow-right', label: 'Go to Journal Entry' }
                ]
            },
            accountBalance: {
                text: "To check an account balance, I can help you:<br><br>" +
                      "• View current balances by period<br>" +
                      "• See beginning and ending balances<br>" +
                      "• Drill down to journal details<br>" +
                      "• Export balance data<br><br>" +
                      "Let me take you to the Account Inquiry page.",
                actions: [
                    { type: 'navigate', data: { page: 'account-inquiry' }, icon: 'arrow-right', label: 'Go to Account Inquiry' }
                ]
            },
            trialBalance: {
                text: "The Trial Balance report shows:<br><br>" +
                      "• All account balances for a specific period<br>" +
                      "• Total debits and credits<br>" +
                      "• Verification that books are in balance<br><br>" +
                      "You can generate it for any open or closed period.",
                actions: [
                    { type: 'navigate', data: { page: 'trial-balance' }, icon: 'arrow-right', label: 'Run Trial Balance' }
                ]
            },
            periodStatus: {
                text: "Period Management allows you to:<br><br>" +
                      "• <strong>Open periods</strong> - Enable posting for new periods<br>" +
                      "• <strong>Close periods</strong> - Lock periods from further posting<br>" +
                      "• <strong>View status</strong> - Check which periods are open/closed<br><br>" +
                      "⚠️ Note: You can only post to open periods.",
                actions: [
                    { type: 'navigate', data: { page: 'period-status' }, icon: 'arrow-right', label: 'Check Period Status' }
                ]
            },
            postJournal: {
                text: "To post a journal:<br><br>" +
                      "1. Ensure the journal is complete and balanced<br>" +
                      "2. Verify the period is <strong>OPEN</strong><br>" +
                      "3. Review all journal lines<br>" +
                      "4. Click 'Post' button<br><br>" +
                      "Once posted, the journal will update GL balances. " +
                      "Posted journals cannot be modified (but can be reversed).",
                actions: [
                    { type: 'navigate', data: { page: 'post-journals' }, icon: 'arrow-right', label: 'Go to Post Journals' }
                ]
            },
            help: {
                text: "I can help you with:<br><br>" +
                      "📝 <strong>Transactions</strong><br>" +
                      "• Creating and posting journals<br>" +
                      "• Reversing entries<br>" +
                      "• Recurring journals<br><br>" +
                      "⚙️ <strong>Setup</strong><br>" +
                      "• Ledger configuration<br>" +
                      "• Chart of accounts<br>" +
                      "• Period management<br><br>" +
                      "📊 <strong>Reports & Inquiry</strong><br>" +
                      "• Account balances<br>" +
                      "• Trial balance<br>" +
                      "• Financial reports<br><br>" +
                      "What specific topic would you like to know more about?",
                actions: []
            },
            reports: {
                text: "Available GL reports:<br><br>" +
                      "📄 <strong>Trial Balance</strong> - All account balances<br>" +
                      "📄 <strong>General Ledger Report</strong> - Detailed transactions<br>" +
                      "📄 <strong>Account Analysis</strong> - Account activity<br>" +
                      "📄 <strong>Journal Register</strong> - Posted journals<br><br>" +
                      "Which report would you like to generate?",
                actions: [
                    { type: 'navigate', data: { page: 'trial-balance' }, icon: 'list', label: 'Trial Balance' },
                    { type: 'navigate', data: { page: 'gl-report' }, icon: 'file-pdf', label: 'GL Report' }
                ]
            },
            navigation: {
                text: "I can help you navigate to any page. Here are the main areas:<br><br>" +
                      "• <strong>Setups</strong> - Ledger, COA, Periods<br>" +
                      "• <strong>Transactions</strong> - Journals, Posting<br>" +
                      "• <strong>Budgets</strong> - Budget management<br>" +
                      "• <strong>Inquiry</strong> - Account & journal lookup<br>" +
                      "• <strong>Reports</strong> - Financial reports<br><br>" +
                      "Where would you like to go?",
                actions: []
            },
            default: {
                text: "I'm not sure I understood that correctly. Here are some things I can help you with:<br><br>" +
                      "• Create journal entries<br>" +
                      "• Check account balances<br>" +
                      "• Run reports<br>" +
                      "• Manage periods<br>" +
                      "• Navigate the system<br><br>" +
                      "Try asking me something like:<br>" +
                      "\"How do I create a journal?\" or \"Check account balance\"",
                actions: []
            }
        };
    }

    executeAction(type, data) {
        switch(type) {
            case 'navigate':
                if (window.navigateToPage) {
                    window.navigateToPage(data.page);
                    this.addMessage('copilot', `✅ Navigating to ${data.page}...`);
                    // Close copilot after navigation
                    setTimeout(() => this.close(), 1000);
                }
                break;
            case 'fillForm':
                this.addMessage('copilot', '✅ Form pre-filled! Please review and submit.');
                // TODO: Implement form filling logic
                break;
            case 'runReport':
                this.addMessage('copilot', '📊 Generating report...');
                // TODO: Implement report generation
                break;
            default:
                this.addMessage('copilot', '⚠️ Action not yet implemented.');
        }
    }

    updateContext(page) {
        this.currentContext.page = page;
        // Update quick actions based on new context
        this.updateQuickActions(page);
    }

    updateQuickActions(page) {
        // Context-aware quick actions
        const actions = {
            'journal-entry': [
                { icon: 'plus-circle', text: 'Create Journal Entry', action: 'create-journal' },
                { icon: 'save', text: 'Save Draft', action: 'save-draft' },
                { icon: 'check', text: 'Post Journal', action: 'post-journal' },
                { icon: 'undo', text: 'Reverse Journal', action: 'reverse-journal' }
            ],
            'account-inquiry': [
                { icon: 'calculator', text: 'Check Balance', action: 'account-balance' },
                { icon: 'chart-line', text: 'View Activity', action: 'account-activity' },
                { icon: 'file-export', text: 'Export to Excel', action: 'export-excel' },
                { icon: 'search', text: 'Find Account', action: 'find-account' }
            ],
            'trial-balance': [
                { icon: 'play', text: 'Run Trial Balance', action: 'trial-balance' },
                { icon: 'calendar', text: 'Select Period', action: 'select-period' },
                { icon: 'file-pdf', text: 'Export to PDF', action: 'export-pdf' },
                { icon: 'file-excel', text: 'Export to Excel', action: 'export-excel' }
            ]
        };

        // Default actions if page not defined
        const quickActions = actions[page] || actions['journal-entry'];

        // Update quick actions UI
        const container = document.querySelector('.copilot-quick-actions');
        const buttonsHTML = quickActions.map(action => `
            <button class="quick-action-btn" onclick="copilotQuickAction('${action.action}')">
                <i class="fas fa-${action.icon}"></i>
                ${action.text}
            </button>
        `).join('');

        container.innerHTML = `
            <div class="quick-actions-title">Quick Actions</div>
            ${buttonsHTML}
        `;
    }

    // Method to export conversation history
    exportHistory() {
        const dataStr = JSON.stringify(this.conversationHistory, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `copilot-history-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
    }

    // Future: External AI integration
    async getExternalAIResponse(message) {
        // TODO: Implement OpenAI/Claude/Gemini integration
        const provider = window.AI_CONFIG.provider; // 'openai', 'claude', 'gemini'
        const apiKey = window.AI_CONFIG.apiKey;
        const model = window.AI_CONFIG.model;

        try {
            // Example for OpenAI
            if (provider === 'openai') {
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: model || 'gpt-4',
                        messages: [
                            { role: 'system', content: this.getSystemPrompt() },
                            ...this.conversationHistory.map(h => [
                                { role: 'user', content: h.user },
                                { role: 'assistant', content: h.copilot }
                            ]).flat(),
                            { role: 'user', content: message }
                        ]
                    })
                });

                const data = await response.json();
                return {
                    text: data.choices[0].message.content,
                    actions: []
                };
            }
        } catch (error) {
            console.error('External AI Error:', error);
            // Fallback to local response
            return this.getLocalResponse(message.toLowerCase());
        }
    }

    getSystemPrompt() {
        return `You are a helpful GL (General Ledger) assistant. You help users with:
- Creating and posting journal entries
- Checking account balances
- Running financial reports
- Managing accounting periods
- Navigating the GL system

Current context:
- Module: ${this.currentContext.module}
- Page: ${this.currentContext.page}
- User: ${this.currentContext.user}

Provide clear, concise answers. When appropriate, suggest actions the user can take.`;
    }
}

// Initialize Co-Pilot when DOM is ready
let copilot;
document.addEventListener('DOMContentLoaded', () => {
    copilot = new GLCopilot();
    window.copilot = copilot; // Make it globally accessible
});

// Quick action handler
function copilotQuickAction(action) {
    const messages = {
        'create-journal': 'How do I create a journal entry?',
        'account-balance': 'Check account balance',
        'trial-balance': 'Run trial balance',
        'period-status': 'Check period status',
        'save-draft': 'How do I save a draft?',
        'post-journal': 'How do I post a journal?',
        'reverse-journal': 'How do I reverse a journal?'
    };

    const message = messages[action] || action;
    document.getElementById('copilotInput').value = message;
    copilot.sendMessage();
}

/**
 * GL Module - Main Application Logic
 * Handles navigation, page loading, and menu interactions
 */

class GLApp {
    constructor() {
        this.currentPage = 'journal-entry';
        this.sidebarCollapsed = false;
        this.pages = this.initializePages();
        this.init();
    }

    init() {
        // Initialize hamburger menu
        document.getElementById('hamburger').addEventListener('click', () => this.toggleSidebar());

        // Initialize menu items
        this.initializeMenu();

        // Load initial page
        this.loadPage(this.currentPage);

        // Responsive sidebar
        this.handleResponsive();
        window.addEventListener('resize', () => this.handleResponsive());
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        this.sidebarCollapsed = !this.sidebarCollapsed;
        sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
    }

    handleResponsive() {
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            sidebar.classList.add('collapsed');
            this.sidebarCollapsed = true;
        }
    }

    initializeMenu() {
        // Menu items with submenus
        const menuItems = document.querySelectorAll('.menu-item.has-submenu');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const submenu = item.nextElementSibling;

                // Toggle submenu
                if (submenu && submenu.classList.contains('submenu')) {
                    const isExpanded = item.classList.contains('expanded');

                    // Close all other submenus
                    document.querySelectorAll('.menu-item.has-submenu.expanded').forEach(i => {
                        if (i !== item) {
                            i.classList.remove('expanded');
                            i.nextElementSibling?.classList.remove('expanded');
                        }
                    });

                    // Toggle current submenu
                    item.classList.toggle('expanded', !isExpanded);
                    submenu.classList.toggle('expanded', !isExpanded);
                }
            });
        });

        // Menu items without submenus
        const simpleMenuItems = document.querySelectorAll('.menu-item:not(.has-submenu)');
        simpleMenuItems.forEach(item => {
            item.addEventListener('click', () => {
                const page = item.getAttribute('data-page');
                if (page) {
                    this.navigateToPage(page);
                }
            });
        });

        // Submenu items
        const submenuItems = document.querySelectorAll('.submenu-item');
        submenuItems.forEach(item => {
            item.addEventListener('click', () => {
                const page = item.getAttribute('data-page');
                if (page) {
                    this.navigateToPage(page);
                }
            });
        });
    }

    navigateToPage(pageName) {
        this.currentPage = pageName;
        this.loadPage(pageName);

        // Update active state
        document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
        document.querySelectorAll('.submenu-item').forEach(item => item.classList.remove('active'));

        const activeItem = document.querySelector(`[data-page="${pageName}"]`);
        if (activeItem) {
            activeItem.classList.add('active');

            // Expand parent if it's a submenu item
            if (activeItem.classList.contains('submenu-item')) {
                const parentMenu = activeItem.closest('.submenu').previousElementSibling;
                if (parentMenu) {
                    parentMenu.classList.add('expanded');
                    activeItem.closest('.submenu').classList.add('expanded');
                }
            }
        }

        // Update co-pilot context
        if (window.copilot) {
            window.copilot.updateContext(pageName);
        }

        // Close sidebar on mobile after navigation
        if (window.innerWidth <= 768) {
            this.toggleSidebar();
        }
    }

    loadPage(pageName) {
        const mainContent = document.getElementById('mainContent');
        const pageContent = this.pages[pageName] || this.pages['default'];

        // Fade out
        mainContent.style.opacity = '0';

        setTimeout(() => {
            mainContent.innerHTML = pageContent;
            // Fade in
            mainContent.style.opacity = '1';
        }, 150);
    }

    initializePages() {
        return {
            'journal-entry': document.getElementById('journalEntryTemplate')?.innerHTML || this.getJournalEntryPage(),

            // Setups
            'ledger-setup-define': this.getPlaceholderPage('Define Ledger', 'building', 'Configure your general ledger settings'),
            'ledger-setup-currencies': this.getPlaceholderPage('Currencies', 'dollar-sign', 'Manage currencies and exchange rates'),
            'ledger-setup-calendar': this.getPlaceholderPage('Accounting Calendar', 'calendar-alt', 'Set up accounting periods and fiscal year'),
            'coa-segments': this.getPlaceholderPage('Define Segments', 'puzzle-piece', 'Configure chart of accounts segments'),
            'coa-values': this.getPlaceholderPage('Segment Values', 'list-ol', 'Define values for each segment'),
            'coa-combinations': this.getPlaceholderPage('Account Combinations', 'sitemap', 'Manage valid account combinations'),
            'period-open': this.getPlaceholderPage('Open Period', 'folder-open', 'Open accounting periods for posting'),
            'period-close': this.getPlaceholderPage('Close Period', 'lock', 'Close accounting periods'),
            'period-status': this.getPlaceholderPage('Period Status', 'info-circle', 'View status of all accounting periods'),
            'journal-sources': this.getPlaceholderPage('Journal Sources', 'tag', 'Manage journal sources'),
            'journal-categories': this.getPlaceholderPage('Journal Categories', 'folder', 'Manage journal categories'),

            // Transactions
            'post-journals': this.getPlaceholderPage('Post Journals', 'check-circle', 'Post unposted journals to the general ledger'),
            'reverse-journals': this.getPlaceholderPage('Reverse Journals', 'undo', 'Reverse posted journals'),
            'recurring-define': this.getPlaceholderPage('Define Recurring Journal', 'sync-alt', 'Create recurring journal templates'),
            'recurring-generate': this.getPlaceholderPage('Generate Recurring Journals', 'magic', 'Generate journals from templates'),
            'import-journals': this.getPlaceholderPage('Import Journals', 'upload', 'Import journals from external sources'),

            // Budgets
            'define-budget': this.getPlaceholderPage('Define Budget', 'plus-circle', 'Create new budget versions'),
            'enter-budget': this.getPlaceholderPage('Enter Budget', 'edit', 'Enter budget amounts by account'),
            'budget-inquiry': this.getPlaceholderPage('Budget Inquiry', 'search-dollar', 'View and analyze budget vs actual'),

            // Inquiry
            'account-inquiry': this.getPlaceholderPage('Account Inquiry', 'calculator', 'Query account balances and activity'),
            'journal-inquiry': this.getPlaceholderPage('Journal Inquiry', 'file-alt', 'Search and view journal entries'),
            'balance-inquiry': this.getPlaceholderPage('Balance Inquiry', 'balance-scale', 'View account balances by period'),

            // Reports
            'trial-balance': this.getPlaceholderPage('Trial Balance', 'list', 'Generate trial balance report'),
            'gl-report': this.getPlaceholderPage('General Ledger Report', 'file-pdf', 'Generate detailed GL report'),
            'account-analysis': this.getPlaceholderPage('Account Analysis', 'chart-pie', 'Analyze account activity'),
            'journal-register': this.getPlaceholderPage('Journal Register', 'book-open', 'View posted journals register'),

            // Administration
            'copilot-admin': this.getCopilotAdminPage(),
            'user-management': this.getPlaceholderPage('User Management', 'users-cog', 'Manage users, roles, and permissions'),

            'default': this.get404Page()
        };
    }

    getPlaceholderPage(title, icon, description) {
        return `
            <div class="breadcrumb">
                <a href="#" onclick="app.navigateToPage('journal-entry')"><i class="fas fa-home"></i> Home</a>
                <span class="breadcrumb-separator">/</span>
                <span>${title}</span>
            </div>

            <div class="page-header">
                <h1 class="page-title">
                    <i class="fas fa-${icon}"></i>
                    ${title}
                </h1>
                <p class="page-description">${description}</p>
            </div>

            <div class="content-card" style="text-align: center; padding: 4rem 2rem;">
                <i class="fas fa-${icon}" style="font-size: 4rem; color: var(--primary-light); margin-bottom: 1.5rem;"></i>
                <h2 style="color: var(--gray-700); margin-bottom: 1rem;">Coming Soon</h2>
                <p style="color: var(--gray-600); font-size: 1rem; max-width: 600px; margin: 0 auto;">
                    This page is under development. The complete functionality will be available soon.
                </p>
                <div style="margin-top: 2rem;">
                    <button class="btn btn-primary" onclick="app.navigateToPage('journal-entry')">
                        <i class="fas fa-arrow-left"></i> Back to Journal Entry
                    </button>
                </div>
            </div>
        `;
    }

    getCopilotAdminPage() {
        return `
            <div class="breadcrumb">
                <a href="#" onclick="app.navigateToPage('journal-entry')"><i class="fas fa-home"></i> Home</a>
                <span class="breadcrumb-separator">/</span>
                <span>Co-Pilot Administration</span>
            </div>

            <div class="page-header">
                <h1 class="page-title">
                    <i class="fas fa-robot"></i>
                    Co-Pilot Administration
                </h1>
                <p class="page-description">Configure AI provider, manage prompts, and customize co-pilot behavior</p>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
                <div class="content-card" style="text-align: center;">
                    <i class="fas fa-plug" style="font-size: 2.5rem; color: var(--copilot); margin-bottom: 1rem;"></i>
                    <h3>AI Provider</h3>
                    <p style="color: var(--gray-600); margin: 1rem 0;">Configure external AI integration</p>
                    <button class="btn btn-secondary" style="width: 100%;">
                        <i class="fas fa-cog"></i> Configure
                    </button>
                </div>

                <div class="content-card" style="text-align: center;">
                    <i class="fas fa-comments" style="font-size: 2.5rem; color: var(--primary); margin-bottom: 1rem;"></i>
                    <h3>Prompts Library</h3>
                    <p style="color: var(--gray-600); margin: 1rem 0;">Manage prompt templates</p>
                    <button class="btn btn-secondary" style="width: 100%;">
                        <i class="fas fa-edit"></i> Manage Prompts
                    </button>
                </div>

                <div class="content-card" style="text-align: center;">
                    <i class="fas fa-bolt" style="font-size: 2.5rem; color: var(--warning); margin-bottom: 1rem;"></i>
                    <h3>Quick Actions</h3>
                    <p style="color: var(--gray-600); margin: 1rem 0;">Customize quick actions</p>
                    <button class="btn btn-secondary" style="width: 100%;">
                        <i class="fas fa-sliders-h"></i> Customize
                    </button>
                </div>

                <div class="content-card" style="text-align: center;">
                    <i class="fas fa-chart-line" style="font-size: 2.5rem; color: var(--info); margin-bottom: 1rem;"></i>
                    <h3>Analytics</h3>
                    <p style="color: var(--gray-600); margin: 1rem 0;">Usage statistics and insights</p>
                    <button class="btn btn-secondary" style="width: 100%;">
                        <i class="fas fa-chart-bar"></i> View Analytics
                    </button>
                </div>
            </div>

            <div class="content-card">
                <h3><i class="fas fa-plug"></i> AI Provider Configuration</h3>
                <div style="max-width: 800px;">
                    <div style="margin-bottom: 1.5rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Provider</label>
                        <select style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                            <option value="local">Local (No External API)</option>
                            <option value="openai">OpenAI (ChatGPT)</option>
                            <option value="claude">Anthropic (Claude)</option>
                            <option value="gemini">Google (Gemini)</option>
                            <option value="azure">Azure OpenAI</option>
                            <option value="custom">Custom Endpoint</option>
                        </select>
                    </div>

                    <div style="margin-bottom: 1.5rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">API Key</label>
                        <input type="password" placeholder="Enter API key" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                    </div>

                    <div style="margin-bottom: 1.5rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Model</label>
                        <input type="text" placeholder="e.g., gpt-4, claude-3-opus" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                    </div>

                    <div style="display: flex; gap: 1rem;">
                        <button class="btn btn-secondary">
                            <i class="fas fa-vial"></i> Test Connection
                        </button>
                        <button class="btn btn-primary">
                            <i class="fas fa-save"></i> Save Configuration
                        </button>
                    </div>
                </div>
            </div>

            <div class="content-card">
                <h3><i class="fas fa-info-circle"></i> About Co-Pilot</h3>
                <p style="color: var(--gray-600); line-height: 1.8;">
                    The GL Co-Pilot is an AI-powered assistant designed to help you navigate the General Ledger module,
                    create transactions, run reports, and answer questions. It can work standalone with pre-defined responses
                    or integrate with external AI providers for more advanced capabilities.
                </p>
                <div style="margin-top: 1.5rem; padding: 1rem; background: var(--gray-50); border-radius: 8px; border-left: 4px solid var(--copilot);">
                    <strong>Current Status:</strong> Running in Local Mode<br>
                    <strong>Version:</strong> 1.0<br>
                    <strong>Total Conversations:</strong> ${window.copilot?.conversationHistory?.length || 0}
                </div>
            </div>
        `;
    }

    getJournalEntryPage() {
        return document.getElementById('journalEntryTemplate')?.innerHTML || '<p>Journal Entry page loading...</p>';
    }

    get404Page() {
        return `
            <div class="content-card" style="text-align: center; padding: 4rem 2rem;">
                <i class="fas fa-exclamation-triangle" style="font-size: 4rem; color: var(--warning); margin-bottom: 1.5rem;"></i>
                <h2 style="color: var(--gray-700); margin-bottom: 1rem;">Page Not Found</h2>
                <p style="color: var(--gray-600);">The requested page could not be found.</p>
                <button class="btn btn-primary" onclick="app.navigateToPage('journal-entry')" style="margin-top: 1.5rem;">
                    <i class="fas fa-home"></i> Go to Home
                </button>
            </div>
        `;
    }
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new GLApp();
    window.app = app;
    window.navigateToPage = (page) => app.navigateToPage(page);
});

// Add smooth transition to main content
document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.getElementById('mainContent');
    mainContent.style.transition = 'opacity 0.15s ease';
});

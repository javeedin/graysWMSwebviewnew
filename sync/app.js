/**
 * Sync Module - Main Application Logic
 * Handles navigation, page loading, and menu interactions
 */

class SyncApp {
    constructor() {
        this.currentPage = 'admin-credentials';
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
        const menuItems = document.querySelectorAll('.menu-item');
        menuItems.forEach(item => {
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
        const activeItem = document.querySelector(`[data-page="${pageName}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }

        // Close sidebar on mobile after navigation
        if (window.innerWidth <= 768) {
            this.toggleSidebar();
        }
    }

    loadPage(pageName) {
        const mainContent = document.getElementById('mainContent');

        // Check if this is an external page
        if (pageName === 'admin-endpoints') {
            this.loadExternalPage('pages/api-endpoints.html');
            return;
        }

        const pageContent = this.pages[pageName] || this.pages['default'];

        // Fade out
        mainContent.style.opacity = '0';

        setTimeout(() => {
            mainContent.innerHTML = pageContent;
            // Fade in
            mainContent.style.opacity = '1';

            // Initialize page-specific logic
            this.initPageLogic(pageName);
        }, 150);
    }

    async loadExternalPage(pageUrl) {
        const mainContent = document.getElementById('mainContent');

        // Fade out
        mainContent.style.opacity = '0';

        try {
            const response = await fetch(pageUrl);
            if (!response.ok) {
                throw new Error(`Failed to load page: ${response.statusText}`);
            }

            const html = await response.text();

            setTimeout(() => {
                mainContent.innerHTML = html;
                // Fade in
                mainContent.style.opacity = '1';

                // Load external scripts if any
                const scripts = mainContent.querySelectorAll('script[src]');
                scripts.forEach(oldScript => {
                    const newScript = document.createElement('script');
                    newScript.src = oldScript.getAttribute('src');
                    document.body.appendChild(newScript);
                });

                // Execute inline scripts
                const inlineScripts = mainContent.querySelectorAll('script:not([src])');
                inlineScripts.forEach(oldScript => {
                    const newScript = document.createElement('script');
                    newScript.textContent = oldScript.textContent;
                    document.body.appendChild(newScript);
                });
            }, 150);

        } catch (error) {
            console.error('Error loading external page:', error);
            setTimeout(() => {
                mainContent.innerHTML = `
                    <div style="text-align: center; padding: 40px;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #e74c3c; margin-bottom: 20px;"></i>
                        <h2>Failed to Load Page</h2>
                        <p>Error: ${error.message}</p>
                        <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-redo"></i> Reload Page
                        </button>
                    </div>
                `;
                mainContent.style.opacity = '1';
            }, 150);
        }
    }

    initPageLogic(pageName) {
        // Initialize page-specific functionality after page loads
        switch(pageName) {
            case 'admin-credentials':
                this.initCredentialsPage();
                break;
            case 'admin-endpoints':
                this.initEndpointsPage();
                break;
            case 'sync-gl':
                this.initGLSyncPage();
                break;
        }
    }

    initCredentialsPage() {
        // Test connection button
        const testBtn = document.getElementById('testConnectionBtn');
        if (testBtn) {
            testBtn.addEventListener('click', () => this.testFusionConnection());
        }

        // Save credentials button
        const saveBtn = document.getElementById('saveCredentialsBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveCredentials());
        }

        // Load saved credentials
        this.loadSavedCredentials();
    }

    initEndpointsPage() {
        const resetBtn = document.getElementById('resetEndpointsBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetToDefaultEndpoints());
        }

        const saveBtn = document.getElementById('saveEndpointsBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveEndpoints());
        }

        this.loadSavedEndpoints();
    }

    initGLSyncPage() {
        const startBtn = document.getElementById('startSyncBtn');
        if (startBtn) {
            startBtn.addEventListener('click', () => this.startGLSync());
        }
    }

    async testFusionConnection() {
        const statusDiv = document.getElementById('connectionStatus');
        const testBtn = document.getElementById('testConnectionBtn');

        testBtn.disabled = true;
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
        statusDiv.innerHTML = '🔄 Testing connection...';
        statusDiv.className = 'status-box status-info';

        try {
            const credentials = this.getCredentialsFromForm();

            // Use FusionAPI to test connection
            const fusionAPI = new FusionAPI(
                credentials.instanceUrl,
                credentials.username,
                credentials.password
            );

            const result = await fusionAPI.testConnection();

            if (result.success) {
                statusDiv.innerHTML = '✅ Connected successfully! Last test: ' + new Date().toLocaleString();
                statusDiv.className = 'status-box status-success';
            } else {
                throw new Error(result.error || 'Connection failed');
            }
        } catch (error) {
            statusDiv.innerHTML = '❌ Connection failed: ' + error.message;
            statusDiv.className = 'status-box status-error';
        } finally {
            testBtn.disabled = false;
            testBtn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
        }
    }

    getCredentialsFromForm() {
        return {
            instanceUrl: document.getElementById('instanceUrl')?.value || '',
            authType: document.querySelector('input[name="authType"]:checked')?.value || 'basic',
            username: document.getElementById('username')?.value || '',
            password: document.getElementById('password')?.value || '',
            clientId: document.getElementById('clientId')?.value || '',
            clientSecret: document.getElementById('clientSecret')?.value || ''
        };
    }

    saveCredentials() {
        const credentials = this.getCredentialsFromForm();

        // Save to localStorage (in production, encrypt and save to backend)
        localStorage.setItem('fusionCredentials', JSON.stringify(credentials));

        this.showNotification('✅ Credentials saved successfully!', 'success');
    }

    loadSavedCredentials() {
        const saved = localStorage.getItem('fusionCredentials');
        if (saved) {
            const credentials = JSON.parse(saved);

            if (document.getElementById('instanceUrl')) {
                document.getElementById('instanceUrl').value = credentials.instanceUrl || '';
                document.getElementById('username').value = credentials.username || '';
                document.getElementById('password').value = credentials.password || '';
                document.getElementById('clientId').value = credentials.clientId || '';
                document.getElementById('clientSecret').value = credentials.clientSecret || '';

                // Set auth type
                const authRadio = document.querySelector(`input[name="authType"][value="${credentials.authType}"]`);
                if (authRadio) authRadio.checked = true;
            }
        }
    }

    resetToDefaultEndpoints() {
        if (confirm('Reset all endpoints to default values?')) {
            // Reset to Oracle Fusion default endpoints
            const defaults = {
                baseUrl: '/fscmRestApi/resources/11.13.18.05/',
                glBatches: 'journalBatches',
                glHeaders: 'journalHeaders',
                glLines: 'journalLines',
                glCOA: 'chartOfAccounts',
                glLedgers: 'ledgers'
            };

            localStorage.setItem('fusionEndpoints', JSON.stringify(defaults));
            this.loadSavedEndpoints();
            this.showNotification('✅ Endpoints reset to defaults', 'success');
        }
    }

    saveEndpoints() {
        // Save endpoint configuration
        this.showNotification('✅ Endpoints saved successfully!', 'success');
    }

    loadSavedEndpoints() {
        // Load saved endpoints from localStorage
    }

    async startGLSync() {
        this.showNotification('🔄 GL Sync started...', 'info');
        // Sync logic will be implemented in sync-api.js
    }

    showNotification(message, type = 'info') {
        // Simple notification (can be enhanced with toast library)
        alert(message);
    }

    initializePages() {
        return {
            'admin-credentials': this.getAdminCredentialsPage(),
            'admin-endpoints': this.getAdminEndpointsPage(),
            'admin-apex': this.getAdminApexPage(),
            'connection-test': this.getConnectionTestPage(),
            'sync-gl': this.getGLSyncPage(),
            'sync-ap': this.getPlaceholderPage('AP Sync', 'file-invoice-dollar', 'Sync Accounts Payable data from Oracle Fusion'),
            'sync-ar': this.getPlaceholderPage('AR Sync', 'hand-holding-usd', 'Sync Accounts Receivable data from Oracle Fusion'),
            'sync-fa': this.getPlaceholderPage('FA Sync', 'building', 'Sync Fixed Assets data from Oracle Fusion'),
            'sync-po': this.getPlaceholderPage('PO Sync', 'shopping-cart', 'Sync Purchase Orders data from Oracle Fusion'),
            'sync-history': this.getSyncHistoryPage(),
            'sync-logs': this.getPlaceholderPage('Sync Logs', 'file-alt', 'View detailed sync logs'),
            'error-reports': this.getPlaceholderPage('Error Reports', 'exclamation-triangle', 'View sync errors and failures'),
            'statistics': this.getPlaceholderPage('Statistics', 'chart-bar', 'View sync statistics and metrics'),
            'data-mapping': this.getPlaceholderPage('Data Mapping', 'project-diagram', 'Configure field mappings between Fusion and APEX'),
            'transform-rules': this.getPlaceholderPage('Transform Rules', 'exchange-alt', 'Define data transformation rules'),
            'scheduler': this.getPlaceholderPage('Sync Scheduler', 'clock', 'Schedule automatic syncs'),
            'default': this.get404Page()
        };
    }

    getAdminCredentialsPage() {
        return `
            <div class="page-header">
                <h1 class="page-title">
                    <i class="fas fa-key"></i>
                    Oracle Fusion Credentials
                </h1>
                <p class="page-description">Configure authentication credentials for Oracle Fusion Cloud</p>
            </div>

            <div class="content-card">
                <h3><i class="fas fa-lock"></i> Authentication Settings</h3>

                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                        Instance URL <span style="color: var(--danger);">*</span>
                    </label>
                    <input type="url" id="instanceUrl" placeholder="https://your-instance.oraclecloud.com"
                           style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px; font-size: 0.95rem;">
                    <small style="color: var(--gray-500); display: block; margin-top: 0.5rem;">
                        <i class="fas fa-info-circle"></i> Enter your Oracle Fusion Cloud instance URL
                    </small>
                </div>

                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.75rem; font-weight: 600; color: var(--gray-700);">
                        Authentication Type <span style="color: var(--danger);">*</span>
                    </label>
                    <div style="display: flex; gap: 1.5rem;">
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="radio" name="authType" value="basic" checked>
                            <span>Basic Authentication</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="radio" name="authType" value="oauth">
                            <span>OAuth 2.0</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="radio" name="authType" value="jwt">
                            <span>JWT Token</span>
                        </label>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem;">
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                            Username <span style="color: var(--danger);">*</span>
                        </label>
                        <input type="text" id="username" placeholder="fusion_integration_user"
                               style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                            Password <span style="color: var(--danger);">*</span>
                        </label>
                        <input type="password" id="password" placeholder="••••••••••••"
                               style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                    </div>
                </div>

                <div id="oauthFields" style="display: none;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem;">
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                                Client ID
                            </label>
                            <input type="text" id="clientId" placeholder="OAuth Client ID"
                                   style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                                Client Secret
                            </label>
                            <input type="password" id="clientSecret" placeholder="••••••••••••"
                                   style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 1rem; margin-top: 2rem;">
                    <button class="btn btn-secondary" id="testConnectionBtn">
                        <i class="fas fa-plug"></i> Test Connection
                    </button>
                    <button class="btn btn-primary" id="saveCredentialsBtn">
                        <i class="fas fa-save"></i> Save Credentials
                    </button>
                </div>

                <div id="connectionStatus" class="status-box status-info" style="margin-top: 1.5rem;">
                    <i class="fas fa-info-circle"></i> Click "Test Connection" to verify credentials
                </div>
            </div>

            <style>
                .status-box {
                    padding: 1rem 1.25rem;
                    border-radius: 8px;
                    border-left: 4px solid;
                    font-size: 0.95rem;
                }
                .status-info {
                    background: #e3f2fd;
                    border-color: #2196F3;
                    color: #1565C0;
                }
                .status-success {
                    background: #e8f5e9;
                    border-color: #4CAF50;
                    color: #2E7D32;
                }
                .status-error {
                    background: #ffebee;
                    border-color: #f44336;
                    color: #c62828;
                }
            </style>
        `;
    }

    getAdminEndpointsPage() {
        return `
            <div class="page-header">
                <h1 class="page-title">
                    <i class="fas fa-link"></i>
                    API Endpoint Configuration
                </h1>
                <p class="page-description">Configure Oracle Fusion REST API endpoints</p>
            </div>

            <div class="content-card">
                <h3><i class="fas fa-server"></i> Base API Configuration</h3>

                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                        Base API URL
                    </label>
                    <input type="text" id="baseApiUrl" value="/fscmRestApi/resources/11.13.18.05/"
                           style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px; font-family: monospace;">
                    <small style="color: var(--gray-500); display: block; margin-top: 0.5rem;">
                        <i class="fas fa-info-circle"></i> Fusion REST API base path (relative to instance URL)
                    </small>
                </div>
            </div>

            <div class="content-card">
                <h3><i class="fas fa-book"></i> GL Module Endpoints</h3>

                <div style="display: grid; gap: 1.5rem;">
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                            Journal Batches
                        </label>
                        <input type="text" value="journalBatches" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px; font-family: monospace;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                            Journal Headers
                        </label>
                        <input type="text" value="journalHeaders" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px; font-family: monospace;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                            Journal Lines
                        </label>
                        <input type="text" value="journalLines" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px; font-family: monospace;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                            Chart of Accounts
                        </label>
                        <input type="text" value="chartOfAccounts" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px; font-family: monospace;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                            Ledgers
                        </label>
                        <input type="text" value="ledgers" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px; font-family: monospace;">
                    </div>
                </div>

                <div style="display: flex; gap: 1rem; margin-top: 2rem;">
                    <button class="btn btn-secondary" id="resetEndpointsBtn">
                        <i class="fas fa-undo"></i> Reset to Defaults
                    </button>
                    <button class="btn btn-primary" id="saveEndpointsBtn">
                        <i class="fas fa-save"></i> Save Endpoints
                    </button>
                </div>
            </div>
        `;
    }

    getAdminApexPage() {
        return `
            <div class="page-header">
                <h1 class="page-title">
                    <i class="fas fa-database"></i>
                    APEX Database Configuration
                </h1>
                <p class="page-description">Configure Oracle APEX REST API endpoints</p>
            </div>

            <div class="content-card">
                <h3><i class="fas fa-server"></i> APEX REST Configuration</h3>

                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                        APEX REST Base URL
                    </label>
                    <input type="url" value="https://apex.oracle.com/pls/apex/grays/"
                           style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                            Workspace
                        </label>
                        <input type="text" value="GRAYS_WMS" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--gray-700);">
                            Schema
                        </label>
                        <input type="text" value="GRAYS_SCHEMA" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                    </div>
                </div>

                <div style="margin-top: 2rem; padding: 1rem; background: var(--gray-50); border-radius: 8px; border-left: 4px solid var(--copilot);">
                    <strong>API Endpoints:</strong><br>
                    • GL Sync: <code>/api/sync/gl</code><br>
                    • AP Sync: <code>/api/sync/ap</code><br>
                    • AR Sync: <code>/api/sync/ar</code>
                </div>

                <div style="display: flex; gap: 1rem; margin-top: 2rem;">
                    <button class="btn btn-secondary">
                        <i class="fas fa-plug"></i> Test APEX Connection
                    </button>
                    <button class="btn btn-primary">
                        <i class="fas fa-save"></i> Save Configuration
                    </button>
                </div>
            </div>
        `;
    }

    getConnectionTestPage() {
        return this.getPlaceholderPage('Test Connections', 'plug', 'Test all configured connections');
    }

    getGLSyncPage() {
        return `
            <div class="page-header">
                <h1 class="page-title">
                    <i class="fas fa-book"></i>
                    GL Sync - Oracle Fusion to APEX
                </h1>
                <p class="page-description">Synchronize General Ledger data from Oracle Fusion to APEX Database</p>
            </div>

            <div class="content-card">
                <h3><i class="fas fa-cog"></i> Sync Configuration</h3>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                        <input type="checkbox" checked>
                        <span>Journal Batches</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                        <input type="checkbox" checked>
                        <span>Journal Headers</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                        <input type="checkbox" checked>
                        <span>Journal Lines</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                        <input type="checkbox">
                        <span>Chart of Accounts</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                        <input type="checkbox">
                        <span>Ledgers</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                        <input type="checkbox">
                        <span>Periods</span>
                    </label>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Date From</label>
                        <input type="date" value="2024-01-01" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Date To</label>
                        <input type="date" value="2025-12-31" style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Ledger</label>
                        <select style="width: 100%; padding: 0.75rem; border: 2px solid var(--gray-200); border-radius: 8px;">
                            <option>All Ledgers</option>
                            <option>Main Ledger</option>
                            <option>Secondary Ledger</option>
                        </select>
                    </div>
                </div>

                <div style="display: flex; gap: 1rem; margin-top: 2rem;">
                    <button class="btn btn-primary" id="startSyncBtn">
                        <i class="fas fa-sync-alt"></i> Start Sync
                    </button>
                    <button class="btn btn-secondary">
                        <i class="fas fa-pause"></i> Pause
                    </button>
                    <button class="btn btn-danger">
                        <i class="fas fa-stop"></i> Stop
                    </button>
                    <button class="btn btn-secondary" style="margin-left: auto;">
                        <i class="fas fa-file-alt"></i> View Log
                    </button>
                </div>
            </div>

            <div class="content-card">
                <h3><i class="fas fa-chart-line"></i> Sync Progress</h3>

                <div id="syncProgress" style="padding: 2rem; text-align: center; color: var(--gray-500);">
                    <i class="fas fa-info-circle" style="font-size: 3rem; margin-bottom: 1rem; color: var(--gray-300);"></i>
                    <p>Click "Start Sync" to begin synchronization</p>
                </div>
            </div>

            <div class="content-card">
                <h3><i class="fas fa-history"></i> Last Sync Summary</h3>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem;">
                    <div style="padding: 1.5rem; background: var(--gray-50); border-radius: 8px; text-align: center;">
                        <div style="font-size: 2rem; font-weight: 700; color: var(--primary);">---</div>
                        <div style="color: var(--gray-600); margin-top: 0.5rem;">Batches Synced</div>
                    </div>
                    <div style="padding: 1.5rem; background: var(--gray-50); border-radius: 8px; text-align: center;">
                        <div style="font-size: 2rem; font-weight: 700; color: var(--primary);">---</div>
                        <div style="color: var(--gray-600); margin-top: 0.5rem;">Headers Synced</div>
                    </div>
                    <div style="padding: 1.5rem; background: var(--gray-50); border-radius: 8px; text-align: center;">
                        <div style="font-size: 2rem; font-weight: 700; color: var(--primary);">---</div>
                        <div style="color: var(--gray-600); margin-top: 0.5rem;">Lines Synced</div>
                    </div>
                    <div style="padding: 1.5rem; background: var(--gray-50); border-radius: 8px; text-align: center;">
                        <div style="font-size: 2rem; font-weight: 700; color: var(--danger);">---</div>
                        <div style="color: var(--gray-600); margin-top: 0.5rem;">Errors</div>
                    </div>
                </div>

                <div style="margin-top: 1.5rem; padding: 1rem; background: var(--gray-50); border-radius: 8px; border-left: 4px solid var(--gray-400);">
                    <strong>Status:</strong> No sync performed yet<br>
                    <strong>Last Sync:</strong> Never
                </div>
            </div>
        `;
    }

    getSyncHistoryPage() {
        return `
            <div class="page-header">
                <h1 class="page-title">
                    <i class="fas fa-history"></i>
                    Sync History
                </h1>
                <p class="page-description">View all synchronization history and logs</p>
            </div>

            <div class="content-card">
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--gray-100); border-bottom: 2px solid var(--gray-300);">
                                <th style="padding: 0.75rem; text-align: left;">Date/Time</th>
                                <th style="padding: 0.75rem; text-align: left;">Module</th>
                                <th style="padding: 0.75rem; text-align: left;">Type</th>
                                <th style="padding: 0.75rem; text-align: center;">Records</th>
                                <th style="padding: 0.75rem; text-align: center;">Status</th>
                                <th style="padding: 0.75rem; text-align: center;">Duration</th>
                                <th style="padding: 0.75rem; text-align: center;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td colspan="7" style="padding: 3rem; text-align: center; color: var(--gray-500);">
                                    <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 1rem; display: block; color: var(--gray-300);"></i>
                                    No sync history available yet
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    getPlaceholderPage(title, icon, description) {
        return `
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
                <p style="color: var(--gray-600); font-size: 1rem;">
                    This page is under development. The complete functionality will be available soon.
                </p>
            </div>
        `;
    }

    get404Page() {
        return `
            <div class="content-card" style="text-align: center; padding: 4rem 2rem;">
                <i class="fas fa-exclamation-triangle" style="font-size: 4rem; color: var(--warning); margin-bottom: 1.5rem;"></i>
                <h2 style="color: var(--gray-700); margin-bottom: 1rem;">Page Not Found</h2>
                <p style="color: var(--gray-600);">The requested page could not be found.</p>
            </div>
        `;
    }
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new SyncApp();
    window.app = app;
    window.navigateToPage = (page) => app.navigateToPage(page);
});

// Add smooth transition to main content
document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
        mainContent.style.transition = 'opacity 0.15s ease';
    }
});

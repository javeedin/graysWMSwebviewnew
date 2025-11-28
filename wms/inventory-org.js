// ============================================================================
// INVENTORY ORGANIZATION MANAGEMENT
// ============================================================================
// Handles organization selection after login and throughout the application
// ============================================================================

// Global state for inventory organization
window.InventoryOrgState = {
    organizations: [],
    selectedOrg: null,
    isLoaded: false,
    isLoading: false
};

// Organization storage keys
const ORG_STORAGE_KEYS = {
    SELECTED_ORG: 'selectedInventoryOrg',
    ORG_ID: 'inventoryOrgId',
    ORG_NAME: 'inventoryOrgName',
    ORG_CODE: 'inventoryOrgCode',
    CLASSIFICATION_CODE: 'inventoryOrgClassificationCode',
    MASTER_ORG_ID: 'inventoryMasterOrgId'
};

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch inventory organizations from the API
 * @param {string} username - The username to fetch organizations for
 * @returns {Promise<Array>} - Array of organization objects
 */
async function fetchInventoryOrganizations(username) {
    console.log('[InventoryOrg] Fetching organizations for user:', username);

    if (window.InventoryOrgState.isLoading) {
        console.log('[InventoryOrg] Already loading, skipping...');
        return window.InventoryOrgState.organizations;
    }

    window.InventoryOrgState.isLoading = true;

    // Build API URL - using the WAREHOUSEMANAGEMENT module endpoint
    const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/inventory/orgs?username=${encodeURIComponent(username)}`;

    console.log('[InventoryOrg] API URL:', apiUrl);

    return new Promise((resolve, reject) => {
        if (!window.chrome?.webview) {
            // For testing outside WebView2, simulate the API response
            console.warn('[InventoryOrg] WebView2 not available, using mock data for testing');
            const mockOrgs = [];
            window.InventoryOrgState.organizations = mockOrgs;
            window.InventoryOrgState.isLoaded = true;
            window.InventoryOrgState.isLoading = false;
            resolve(mockOrgs);
            return;
        }

        sendMessageToCSharp({
            action: "executeGet",
            fullUrl: apiUrl
        }, function(error, data) {
            window.InventoryOrgState.isLoading = false;

            if (error) {
                console.error('[InventoryOrg] Fetch error:', error);
                reject(error);
                return;
            }

            try {
                const response = JSON.parse(data);
                const organizations = response.items || [];

                console.log('[InventoryOrg] Fetched', organizations.length, 'organizations');

                window.InventoryOrgState.organizations = organizations;
                window.InventoryOrgState.isLoaded = true;

                resolve(organizations);
            } catch (parseError) {
                console.error('[InventoryOrg] Parse error:', parseError);
                reject(parseError);
            }
        });
    });
}

// ============================================================================
// STORAGE FUNCTIONS
// ============================================================================

/**
 * Save selected organization to localStorage
 * @param {Object} org - The organization object to save
 */
function saveSelectedOrganization(org) {
    if (!org) {
        console.warn('[InventoryOrg] Cannot save null organization');
        return;
    }

    console.log('[InventoryOrg] Saving selected organization:', org.organization_name);

    // Save full object
    localStorage.setItem(ORG_STORAGE_KEYS.SELECTED_ORG, JSON.stringify(org));

    // Save individual fields for easy access
    localStorage.setItem(ORG_STORAGE_KEYS.ORG_ID, org.organization_id);
    localStorage.setItem(ORG_STORAGE_KEYS.ORG_NAME, org.organization_name);
    localStorage.setItem(ORG_STORAGE_KEYS.ORG_CODE, org.organization_code);
    localStorage.setItem(ORG_STORAGE_KEYS.CLASSIFICATION_CODE, org.classification_code || '');
    localStorage.setItem(ORG_STORAGE_KEYS.MASTER_ORG_ID, org.master_organization_id || '');

    // Update global state
    window.InventoryOrgState.selectedOrg = org;

    // Update UI
    updateOrganizationDisplay();
}

/**
 * Get selected organization from localStorage
 * @returns {Object|null} - The saved organization object or null
 */
function getSelectedOrganization() {
    const savedOrg = localStorage.getItem(ORG_STORAGE_KEYS.SELECTED_ORG);

    if (savedOrg) {
        try {
            const org = JSON.parse(savedOrg);
            window.InventoryOrgState.selectedOrg = org;
            return org;
        } catch (e) {
            console.error('[InventoryOrg] Failed to parse saved organization:', e);
            return null;
        }
    }

    return null;
}

/**
 * Clear selected organization
 */
function clearSelectedOrganization() {
    console.log('[InventoryOrg] Clearing selected organization');

    Object.values(ORG_STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key);
    });

    window.InventoryOrgState.selectedOrg = null;
    updateOrganizationDisplay();
}

/**
 * Check if an organization is selected
 * @returns {boolean}
 */
function hasSelectedOrganization() {
    const org = getSelectedOrganization();
    return org !== null && org.organization_id;
}

// ============================================================================
// GETTER FUNCTIONS FOR GLOBAL ACCESS
// ============================================================================

/**
 * Get the current organization ID
 * @returns {number|null}
 */
function getCurrentOrganizationId() {
    const id = localStorage.getItem(ORG_STORAGE_KEYS.ORG_ID);
    return id ? parseInt(id) : null;
}

/**
 * Get the current organization name
 * @returns {string|null}
 */
function getCurrentOrganizationName() {
    return localStorage.getItem(ORG_STORAGE_KEYS.ORG_NAME);
}

/**
 * Get the current organization code
 * @returns {string|null}
 */
function getCurrentOrganizationCode() {
    return localStorage.getItem(ORG_STORAGE_KEYS.ORG_CODE);
}

/**
 * Get the current master organization ID
 * @returns {number|null}
 */
function getCurrentMasterOrganizationId() {
    const id = localStorage.getItem(ORG_STORAGE_KEYS.MASTER_ORG_ID);
    return id ? parseInt(id) : null;
}

// ============================================================================
// UI FUNCTIONS
// ============================================================================

/**
 * Update the organization display in the toolbar
 */
function updateOrganizationDisplay() {
    const orgNameDisplay = document.getElementById('current-org-name');
    const orgSelector = document.getElementById('org-selector');

    const selectedOrg = getSelectedOrganization();

    if (orgNameDisplay) {
        if (selectedOrg) {
            orgNameDisplay.textContent = selectedOrg.organization_name || 'Select Org';
            orgNameDisplay.title = `${selectedOrg.organization_code} - ${selectedOrg.organization_name}`;
        } else {
            orgNameDisplay.textContent = 'No Org Selected';
            orgNameDisplay.title = 'Click to select an organization';
        }
    }

    if (orgSelector) {
        orgSelector.style.display = 'flex';
    }
}

/**
 * Show organization selection popup
 */
async function showOrganizationSelectionPopup() {
    console.log('[InventoryOrg] Showing organization selection popup');

    const modal = document.getElementById('org-selection-modal');
    if (!modal) {
        console.error('[InventoryOrg] Organization selection modal not found');
        return;
    }

    // Show loading state
    const listContainer = document.getElementById('org-list-container');
    if (listContainer) {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #667eea;">
                <i class="fas fa-spinner fa-spin" style="font-size: 32px; margin-bottom: 1rem;"></i>
                <p>Loading organizations...</p>
            </div>
        `;
    }

    // Show modal
    modal.style.display = 'flex';

    // Fetch organizations
    const username = localStorage.getItem('username') || '';

    try {
        const orgs = await fetchInventoryOrganizations(username);
        renderOrganizationList(orgs);
    } catch (error) {
        console.error('[InventoryOrg] Failed to fetch organizations:', error);
        if (listContainer) {
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #ef4444;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 32px; margin-bottom: 1rem;"></i>
                    <p>Failed to load organizations</p>
                    <p style="font-size: 0.875rem; color: #64748b;">${error}</p>
                    <button onclick="showOrganizationSelectionPopup()" class="btn" style="margin-top: 1rem;">
                        <i class="fas fa-sync-alt"></i> Retry
                    </button>
                </div>
            `;
        }
    }
}

/**
 * Render the organization list in the popup
 * @param {Array} organizations - Array of organization objects
 */
function renderOrganizationList(organizations) {
    const listContainer = document.getElementById('org-list-container');
    if (!listContainer) return;

    if (!organizations || organizations.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #64748b;">
                <i class="fas fa-building" style="font-size: 32px; margin-bottom: 1rem; opacity: 0.5;"></i>
                <p>No organizations available</p>
            </div>
        `;
        return;
    }

    const currentOrg = getSelectedOrganization();
    const currentOrgId = currentOrg ? currentOrg.organization_id : null;

    let html = '<div class="org-list">';

    organizations.forEach(org => {
        const isSelected = org.organization_id === currentOrgId;
        const statusClass = org.status === 'A' ? 'active' : 'inactive';

        html += `
            <div class="org-list-item ${isSelected ? 'selected' : ''}"
                 onclick="selectOrganization(${org.organization_id})"
                 data-org-id="${org.organization_id}">
                <div class="org-info">
                    <div class="org-name">
                        ${isSelected ? '<i class="fas fa-check-circle" style="color: #10b981; margin-right: 0.5rem;"></i>' : ''}
                        ${org.organization_name}
                    </div>
                    <div class="org-details">
                        <span class="org-code">${org.organization_code}</span>
                        <span class="org-status ${statusClass}">${org.status === 'A' ? 'Active' : 'Inactive'}</span>
                        ${org.classification_code ? `<span class="org-class">${org.classification_code}</span>` : ''}
                    </div>
                </div>
                <i class="fas fa-chevron-right" style="color: #94a3b8;"></i>
            </div>
        `;
    });

    html += '</div>';
    listContainer.innerHTML = html;
}

/**
 * Select an organization by ID
 * @param {number} organizationId - The organization ID to select
 */
function selectOrganization(organizationId) {
    console.log('[InventoryOrg] Selecting organization:', organizationId);

    const org = window.InventoryOrgState.organizations.find(o => o.organization_id === organizationId);

    if (!org) {
        console.error('[InventoryOrg] Organization not found:', organizationId);
        return;
    }

    // Save selection
    saveSelectedOrganization(org);

    // Close modal
    closeOrganizationSelectionPopup();

    // Show success notification
    showOrgNotification(`Organization set to: ${org.organization_name}`, 'success');
}

/**
 * Close the organization selection popup
 */
function closeOrganizationSelectionPopup() {
    const modal = document.getElementById('org-selection-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Toggle organization dropdown menu
 */
function toggleOrgMenu() {
    const menu = document.getElementById('org-dropdown-menu');
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

/**
 * Show organization notification
 * @param {string} message - Message to show
 * @param {string} type - 'success', 'error', 'info'
 */
function showOrgNotification(message, type = 'info') {
    const notification = document.createElement('div');

    const bgColors = {
        success: '#10b981',
        error: '#ef4444',
        info: '#667eea'
    };

    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: ${bgColors[type] || bgColors.info};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10001;
        font-weight: 600;
        animation: slideIn 0.3s ease-out;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    `;

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    };

    notification.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${message}`;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize organization management after login
 * Call this after successful login to check if org selection is needed
 */
async function initializeOrganizationManagement() {
    console.log('[InventoryOrg] Initializing organization management...');

    // Load saved organization
    const savedOrg = getSelectedOrganization();

    // Update display
    updateOrganizationDisplay();

    // If no organization is selected, show the selection popup
    if (!savedOrg) {
        console.log('[InventoryOrg] No organization selected, showing selection popup');
        // Small delay to ensure page is fully loaded
        setTimeout(() => {
            showOrganizationSelectionPopup();
        }, 500);
    } else {
        console.log('[InventoryOrg] Organization already selected:', savedOrg.organization_name);
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const orgSelector = document.getElementById('org-selector');
    const orgMenu = document.getElementById('org-dropdown-menu');

    if (orgSelector && orgMenu && !orgSelector.contains(e.target) && !orgMenu.contains(e.target)) {
        orgMenu.style.display = 'none';
    }
});

// ============================================================================
// EXPORTS - Make functions available globally
// ============================================================================

window.fetchInventoryOrganizations = fetchInventoryOrganizations;
window.saveSelectedOrganization = saveSelectedOrganization;
window.getSelectedOrganization = getSelectedOrganization;
window.clearSelectedOrganization = clearSelectedOrganization;
window.hasSelectedOrganization = hasSelectedOrganization;
window.getCurrentOrganizationId = getCurrentOrganizationId;
window.getCurrentOrganizationName = getCurrentOrganizationName;
window.getCurrentOrganizationCode = getCurrentOrganizationCode;
window.getCurrentMasterOrganizationId = getCurrentMasterOrganizationId;
window.showOrganizationSelectionPopup = showOrganizationSelectionPopup;
window.closeOrganizationSelectionPopup = closeOrganizationSelectionPopup;
window.selectOrganization = selectOrganization;
window.toggleOrgMenu = toggleOrgMenu;
window.initializeOrganizationManagement = initializeOrganizationManagement;
window.updateOrganizationDisplay = updateOrganizationDisplay;

console.log('[InventoryOrg] Inventory Organization module loaded');

// API Endpoints Configuration JavaScript
// ============================================================================

// Configuration
const API_CONFIG = {
    baseUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/REERP/API/rr',
    endpoints: {
        getAll: '/endpoints',
        getById: '/endpoints/:id',
        create: '/endpoints',
        update: '/endpoints/:id',
        delete: '/endpoints/:id'
    }
};

// Global state
let allEndpoints = [];
let currentEditingId = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('API Endpoints page loaded');
    loadEndpoints();

    // Try to get base URL from C# if available
    getBaseUrlFromCSharp();
});

// ============================================================================
// API BASE URL MANAGEMENT
// ============================================================================

/**
 * Try to get base URL from C# application
 */
function getBaseUrlFromCSharp() {
    if (window.chrome && window.chrome.webview) {
        // Send message to C# to get the base URL
        window.chrome.webview.postMessage({
            type: 'GET_API_BASE_URL',
            module: 'SYNC'
        });

        // Listen for response
        window.chrome.webview.addEventListener('message', function(event) {
            if (event.data.type === 'API_BASE_URL_RESPONSE') {
                if (event.data.baseUrl) {
                    API_CONFIG.baseUrl = event.data.baseUrl;
                    console.log('Base URL updated from C#:', API_CONFIG.baseUrl);
                }
            }
        });
    }
}

/**
 * Get full API URL
 */
function getApiUrl(endpoint, params = {}) {
    let url = API_CONFIG.baseUrl + API_CONFIG.endpoints[endpoint];

    // Replace path parameters
    Object.keys(params).forEach(key => {
        url = url.replace(`:${key}`, params[key]);
    });

    return url;
}

// ============================================================================
// LOAD & DISPLAY ENDPOINTS
// ============================================================================

/**
 * Load all endpoints from API
 */
async function loadEndpoints() {
    showLoading(true);
    hideMessages();

    try {
        const url = getApiUrl('getAll') + '?limit=100&offset=0';
        console.log('Fetching endpoints from:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('API Response:', data);

        if (data.status === 'SUCCESS' && data.data && data.data.endpoints) {
            allEndpoints = data.data.endpoints;
            displayEndpoints(allEndpoints);
            showSuccess(`Loaded ${allEndpoints.length} endpoints successfully`);
        } else {
            throw new Error(data.message || 'Failed to load endpoints');
        }

    } catch (error) {
        console.error('Error loading endpoints:', error);
        showError('Failed to load endpoints: ' + error.message);
        allEndpoints = [];
        displayEndpoints([]);
    } finally {
        showLoading(false);
    }
}

/**
 * Display endpoints in table
 */
function displayEndpoints(endpoints) {
    const tbody = document.getElementById('endpointsTableBody');
    const table = document.getElementById('endpointsTable');
    const loading = document.getElementById('loadingIndicator');

    tbody.innerHTML = '';

    if (endpoints.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: #7f8c8d;">
                    <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 10px; display: block;"></i>
                    No endpoints found. Click "Create Endpoint" to add one.
                </td>
            </tr>
        `;
    } else {
        endpoints.forEach(endpoint => {
            const row = createTableRow(endpoint);
            tbody.appendChild(row);
        });
    }

    table.style.display = 'table';
    loading.style.display = 'none';
}

/**
 * Create table row for an endpoint
 */
function createTableRow(endpoint) {
    const tr = document.createElement('tr');

    const statusBadge = endpoint.is_active === 'Y'
        ? '<span class="badge badge-success"><i class="fas fa-check-circle"></i> Active</span>'
        : '<span class="badge badge-danger"><i class="fas fa-times-circle"></i> Inactive</span>';

    const methodBadge = `<span class="badge badge-info">${endpoint.http_method}</span>`;

    tr.innerHTML = `
        <td>${endpoint.endpoint_id}</td>
        <td><strong>${endpoint.module_code}</strong></td>
        <td>${endpoint.feature_name || '-'}</td>
        <td><code style="font-size: 12px; background: #f8f9fa; padding: 2px 6px; border-radius: 3px;">${endpoint.endpoint_path}</code></td>
        <td>${methodBadge}</td>
        <td>${statusBadge}</td>
        <td>
            <button class="btn btn-sm btn-primary" onclick="editEndpoint(${endpoint.endpoint_id})" title="Edit">
                <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteEndpoint(${endpoint.endpoint_id})" title="Delete">
                <i class="fas fa-trash"></i>
            </button>
        </td>
    `;

    return tr;
}

// ============================================================================
// MODAL OPERATIONS
// ============================================================================

/**
 * Open modal for creating new endpoint
 */
function openCreateModal() {
    currentEditingId = null;
    document.getElementById('modalTitle').textContent = 'Create New Endpoint';
    document.getElementById('endpointForm').reset();
    document.getElementById('endpoint_id').value = '';
    document.getElementById('is_active').checked = true;
    document.getElementById('endpointModal').classList.add('active');
}

/**
 * Open modal for editing endpoint
 */
function editEndpoint(id) {
    const endpoint = allEndpoints.find(e => e.endpoint_id === id);
    if (!endpoint) {
        showError('Endpoint not found');
        return;
    }

    currentEditingId = id;
    document.getElementById('modalTitle').textContent = 'Edit Endpoint';

    // Fill form with endpoint data
    document.getElementById('endpoint_id').value = endpoint.endpoint_id;
    document.getElementById('module_code').value = endpoint.module_code || '';
    document.getElementById('feature_name').value = endpoint.feature_name || '';
    document.getElementById('workspace_url').value = endpoint.workspace_url || '';
    document.getElementById('endpoint_path').value = endpoint.endpoint_path || '';
    document.getElementById('http_method').value = endpoint.http_method || 'GET';
    document.getElementById('content_type').value = endpoint.content_type || 'application/json';
    document.getElementById('timeout_seconds').value = endpoint.timeout_seconds || 30;
    document.getElementById('retry_count').value = endpoint.retry_count || 0;
    document.getElementById('description').value = endpoint.description || '';
    document.getElementById('requires_auth').checked = endpoint.requires_auth === 'Y';
    document.getElementById('is_active').checked = endpoint.is_active === 'Y';

    document.getElementById('endpointModal').classList.add('active');
}

/**
 * Close modal
 */
function closeModal() {
    document.getElementById('endpointModal').classList.remove('active');
    currentEditingId = null;
}

// ============================================================================
// SAVE ENDPOINT (CREATE/UPDATE)
// ============================================================================

/**
 * Save endpoint (create or update)
 */
async function saveEndpoint() {
    const form = document.getElementById('endpointForm');

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const formData = {
        module_code: document.getElementById('module_code').value,
        feature_name: document.getElementById('feature_name').value,
        workspace_url: document.getElementById('workspace_url').value,
        endpoint_path: document.getElementById('endpoint_path').value,
        http_method: document.getElementById('http_method').value,
        content_type: document.getElementById('content_type').value,
        timeout_seconds: parseInt(document.getElementById('timeout_seconds').value),
        retry_count: parseInt(document.getElementById('retry_count').value),
        description: document.getElementById('description').value,
        requires_auth: document.getElementById('requires_auth').checked ? 'Y' : 'N',
        is_active: document.getElementById('is_active').checked ? 'Y' : 'N',
        response_format: 'JSON'
    };

    try {
        let url, method;

        if (currentEditingId) {
            // Update existing
            url = getApiUrl('update', { id: currentEditingId });
            method = 'PUT';
            formData.endpoint_id = currentEditingId;
        } else {
            // Create new
            url = getApiUrl('create');
            method = 'POST';
        }

        console.log(`${method} to ${url}`, formData);

        const response = await fetch(url, {
            method: method,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.log('Save response:', result);

        if (result.status === 'SUCCESS' || result.success === true) {
            showSuccess(currentEditingId ? 'Endpoint updated successfully' : 'Endpoint created successfully');
            closeModal();
            loadEndpoints(); // Reload the list
        } else {
            throw new Error(result.message || 'Failed to save endpoint');
        }

    } catch (error) {
        console.error('Error saving endpoint:', error);
        showError('Failed to save endpoint: ' + error.message);
    }
}

// ============================================================================
// DELETE ENDPOINT
// ============================================================================

/**
 * Delete endpoint
 */
async function deleteEndpoint(id) {
    if (!confirm('Are you sure you want to delete this endpoint?')) {
        return;
    }

    try {
        const url = getApiUrl('delete', { id: id });
        console.log('DELETE to', url);

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.log('Delete response:', result);

        if (result.status === 'SUCCESS' || result.success === true) {
            showSuccess('Endpoint deleted successfully');
            loadEndpoints(); // Reload the list
        } else {
            throw new Error(result.message || 'Failed to delete endpoint');
        }

    } catch (error) {
        console.error('Error deleting endpoint:', error);
        showError('Failed to delete endpoint: ' + error.message);
    }
}

// ============================================================================
// SEARCH & FILTER
// ============================================================================

/**
 * Filter table based on search input
 */
function filterTable() {
    const searchText = document.getElementById('searchInput').value.toLowerCase();

    if (!searchText) {
        displayEndpoints(allEndpoints);
        return;
    }

    const filtered = allEndpoints.filter(endpoint => {
        return (
            endpoint.module_code?.toLowerCase().includes(searchText) ||
            endpoint.feature_name?.toLowerCase().includes(searchText) ||
            endpoint.endpoint_path?.toLowerCase().includes(searchText) ||
            endpoint.http_method?.toLowerCase().includes(searchText) ||
            endpoint.description?.toLowerCase().includes(searchText)
        );
    });

    displayEndpoints(filtered);
}

// ============================================================================
// UI HELPERS
// ============================================================================

/**
 * Show/hide loading indicator
 */
function showLoading(show) {
    const loading = document.getElementById('loadingIndicator');
    const table = document.getElementById('endpointsTable');

    if (show) {
        loading.style.display = 'block';
        table.style.display = 'none';
    } else {
        loading.style.display = 'none';
        table.style.display = 'table';
    }
}

/**
 * Show error message
 */
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';

    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

/**
 * Show success message
 */
function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    successDiv.textContent = message;
    successDiv.style.display = 'block';

    setTimeout(() => {
        successDiv.style.display = 'none';
    }, 3000);
}

/**
 * Hide all messages
 */
function hideMessages() {
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('successMessage').style.display = 'none';
}

// ============================================================================
// EXPORT
// ============================================================================

// Make functions available globally
window.loadEndpoints = loadEndpoints;
window.openCreateModal = openCreateModal;
window.closeModal = closeModal;
window.editEndpoint = editEndpoint;
window.deleteEndpoint = deleteEndpoint;
window.saveEndpoint = saveEndpoint;
window.filterTable = filterTable;

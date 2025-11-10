// Sync Jobs Management JavaScript
// API Base URL - Update this to match your ORDS endpoint
const API_BASE_URL = 'https://apex.oracle.com/pls/apex/wksp_graysapp/rr';

// State
let configuredJobsData = [];
let catalogData = [];
let historyData = [];
let autoRefreshInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeTabs();
    loadStatistics();
    loadConfiguredJobs();
    loadJobCatalog();
    loadExecutionHistory();
});

// Tab Navigation
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all tabs
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            // Add active class to clicked tab
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');

            // Load data for the active tab
            if (tabId === 'configured-jobs') {
                loadConfiguredJobs();
            } else if (tabId === 'job-catalog') {
                loadJobCatalog();
            } else if (tabId === 'execution-history') {
                loadExecutionHistory();
            }
        });
    });
}

// ============================================================================
// STATISTICS
// ============================================================================

async function loadStatistics() {
    try {
        const response = await fetch(`${API_BASE_URL}/sync/jobs/statistics`);
        const data = await response.json();

        document.getElementById('statTotalJobs').textContent = data.totalJobs || 0;
        document.getElementById('statActiveJobs').textContent = data.activeJobs || 0;

        // Calculate success rate
        if (data.totalExecutions > 0) {
            const successRate = ((data.totalSuccesses / data.totalExecutions) * 100).toFixed(1);
            document.getElementById('statSuccessRate').textContent = successRate + '%';
        } else {
            document.getElementById('statSuccessRate').textContent = '0%';
        }

        document.getElementById('statFailedToday').textContent = data.totalFailures || 0;
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

// ============================================================================
// CONFIGURED JOBS TAB
// ============================================================================

async function loadConfiguredJobs(showLoading = false) {
    if (showLoading) {
        document.getElementById('loadingConfiguredJobs').style.display = 'block';
        document.getElementById('configuredJobsTable').style.display = 'none';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/sync/jobs/header`);
        configuredJobsData = await response.json();

        renderConfiguredJobs(configuredJobsData.items || configuredJobsData);

        document.getElementById('loadingConfiguredJobs').style.display = 'none';
        document.getElementById('configuredJobsTable').style.display = 'table';

        // Refresh statistics
        loadStatistics();
    } catch (error) {
        console.error('Error loading configured jobs:', error);
        showError('Failed to load configured jobs: ' + error.message);
        document.getElementById('loadingConfiguredJobs').style.display = 'none';
    }
}

function renderConfiguredJobs(jobs) {
    const tbody = document.getElementById('configuredJobsBody');
    tbody.innerHTML = '';

    if (!jobs || jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #7f8c8d;">No configured jobs found</td></tr>';
        return;
    }

    jobs.forEach(job => {
        const successRate = job.totalExecutions > 0
            ? ((job.successCount / job.totalExecutions) * 100).toFixed(1) + '%'
            : 'N/A';

        const statusBadge = getStatusBadge(job.scheduleStatus);
        const lastRun = job.lastRunDate ? formatDateTime(job.lastRunDate) : 'Never';

        const row = `
            <tr>
                <td><strong>${job.jobName}</strong></td>
                <td><span class="badge badge-info">${job.module}</span></td>
                <td>${job.masterJobName || 'N/A'}</td>
                <td>${job.scheduleFrequency} ${job.scheduleTime || ''}</td>
                <td>${statusBadge}</td>
                <td>${lastRun}</td>
                <td>${successRate} (${job.successCount}/${job.totalExecutions})</td>
                <td>
                    <button class="btn btn-success btn-sm" onclick="runJob(${job.syncJobId})" title="Run Now">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="editJob(${job.syncJobId})" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="viewJobHistory(${job.syncJobId})" title="History">
                        <i class="fas fa-history"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteJob(${job.syncJobId})" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function filterConfiguredJobs() {
    const search = document.getElementById('searchConfiguredJobs').value.toLowerCase();
    const module = document.getElementById('filterModule').value;
    const status = document.getElementById('filterStatus').value;
    const frequency = document.getElementById('filterFrequency').value;

    const filtered = configuredJobsData.filter(job => {
        const matchesSearch = job.jobName.toLowerCase().includes(search) ||
                            job.jobDescription?.toLowerCase().includes(search);
        const matchesModule = !module || job.module === module;
        const matchesStatus = !status || job.scheduleStatus === status;
        const matchesFrequency = !frequency || job.scheduleFrequency === frequency;

        return matchesSearch && matchesModule && matchesStatus && matchesFrequency;
    });

    renderConfiguredJobs(filtered);
}

// ============================================================================
// JOB CATALOG TAB
// ============================================================================

async function loadJobCatalog(showLoading = false) {
    if (showLoading) {
        document.getElementById('loadingCatalog').style.display = 'block';
        document.getElementById('catalogTable').style.display = 'none';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/sync/jobs/master?is_active=Y`);
        catalogData = await response.json();

        renderCatalog(catalogData.items || catalogData);

        document.getElementById('loadingCatalog').style.display = 'none';
        document.getElementById('catalogTable').style.display = 'table';
    } catch (error) {
        console.error('Error loading job catalog:', error);
        showError('Failed to load job catalog: ' + error.message);
        document.getElementById('loadingCatalog').style.display = 'none';
    }
}

function renderCatalog(catalog) {
    const tbody = document.getElementById('catalogBody');
    tbody.innerHTML = '';

    if (!catalog || catalog.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #7f8c8d;">No jobs in catalog</td></tr>';
        return;
    }

    catalog.forEach(job => {
        const row = `
            <tr>
                <td><span class="badge badge-info">${job.module}</span></td>
                <td><strong>${job.jobName}</strong></td>
                <td><code>${job.jobCode}</code></td>
                <td>${job.apiType}</td>
                <td><small>${job.sourceEndpoint}</small></td>
                <td>${job.description || 'N/A'}</td>
                <td>
                    <button class="btn btn-primary btn-sm" onclick="createFromCatalog(${job.jobMasterId})">
                        <i class="fas fa-plus"></i> Create Job
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function filterCatalog() {
    const search = document.getElementById('searchCatalog').value.toLowerCase();

    const filtered = catalogData.filter(job => {
        return job.jobName.toLowerCase().includes(search) ||
               job.jobCode.toLowerCase().includes(search) ||
               job.module.toLowerCase().includes(search) ||
               job.description?.toLowerCase().includes(search);
    });

    renderCatalog(filtered);
}

// ============================================================================
// EXECUTION HISTORY TAB
// ============================================================================

async function loadExecutionHistory(showLoading = false) {
    if (showLoading) {
        document.getElementById('loadingHistory').style.display = 'block';
        document.getElementById('historyTable').style.display = 'none';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/sync/jobs/details?limit=100`);
        historyData = await response.json();

        renderHistory(historyData.items || historyData);

        document.getElementById('loadingHistory').style.display = 'none';
        document.getElementById('historyTable').style.display = 'table';
    } catch (error) {
        console.error('Error loading execution history:', error);
        showError('Failed to load execution history: ' + error.message);
        document.getElementById('loadingHistory').style.display = 'none';
    }
}

function renderHistory(history) {
    const tbody = document.getElementById('historyBody');
    tbody.innerHTML = '';

    if (!history || history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #7f8c8d;">No execution history found</td></tr>';
        return;
    }

    history.forEach(exec => {
        const statusBadge = getExecutionStatusBadge(exec.syncStatus);
        const duration = exec.durationSeconds ? exec.durationSeconds + 's' : 'N/A';

        const row = `
            <tr>
                <td><strong>${exec.jobName}</strong></td>
                <td><span class="badge badge-info">${exec.module}</span></td>
                <td>${formatDateTime(exec.startTime)}</td>
                <td>${duration}</td>
                <td>${exec.fetchedRecords || 0}</td>
                <td>${exec.syncedRecords || 0}</td>
                <td>${exec.errorRecords || 0}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-primary btn-sm" onclick="viewExecutionDetails(${exec.executionId})" title="Details">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function filterHistory() {
    const search = document.getElementById('searchHistory').value.toLowerCase();
    const module = document.getElementById('filterHistoryModule').value;
    const status = document.getElementById('filterHistoryStatus').value;
    const startDate = document.getElementById('filterStartDate').value;
    const endDate = document.getElementById('filterEndDate').value;

    const filtered = historyData.filter(exec => {
        const matchesSearch = exec.jobName.toLowerCase().includes(search);
        const matchesModule = !module || exec.module === module;
        const matchesStatus = !status || exec.syncStatus === status;

        let matchesDate = true;
        if (startDate && exec.startDate) {
            matchesDate = matchesDate && exec.startDate >= startDate;
        }
        if (endDate && exec.startDate) {
            matchesDate = matchesDate && exec.startDate <= endDate;
        }

        return matchesSearch && matchesModule && matchesStatus && matchesDate;
    });

    renderHistory(filtered);
}

function autoRefreshHistory() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        showSuccess('Auto-refresh stopped');
    } else {
        autoRefreshInterval = setInterval(() => {
            loadExecutionHistory();
        }, 30000); // Refresh every 30 seconds
        showSuccess('Auto-refresh enabled (30s interval)');
    }
}

// ============================================================================
// JOB ACTIONS
// ============================================================================

function openCreateJobModal() {
    document.getElementById('jobModalTitle').textContent = 'Create Sync Job';
    document.getElementById('jobForm').reset();
    document.getElementById('syncJobId').value = '';

    // Populate job master dropdown
    populateJobMasterDropdown();

    document.getElementById('jobModal').classList.add('active');
}

async function populateJobMasterDropdown() {
    try {
        const response = await fetch(`${API_BASE_URL}/sync/jobs/master?is_active=Y`);
        const data = await response.json();
        const catalog = data.items || data;

        const select = document.getElementById('jobMasterId');
        select.innerHTML = '<option value="">Select from catalog...</option>';

        catalog.forEach(job => {
            const option = document.createElement('option');
            option.value = job.jobMasterId;
            option.textContent = `${job.module} - ${job.jobName}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading catalog for dropdown:', error);
    }
}

function createFromCatalog(jobMasterId) {
    openCreateJobModal();
    document.getElementById('jobMasterId').value = jobMasterId;
    loadMasterJobDetails();
}

async function loadMasterJobDetails() {
    const jobMasterId = document.getElementById('jobMasterId').value;
    if (!jobMasterId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/sync/jobs/master/${jobMasterId}`);
        const job = await response.json();

        // Pre-fill some fields from master job
        if (!document.getElementById('jobName').value) {
            document.getElementById('jobName').value = job.jobName + ' - ' + new Date().toISOString().split('T')[0];
        }
    } catch (error) {
        console.error('Error loading master job details:', error);
    }
}

async function saveJob() {
    const form = document.getElementById('jobForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const formData = {
        syncJobId: document.getElementById('syncJobId').value || null,
        jobMasterId: parseInt(document.getElementById('jobMasterId').value),
        jobName: document.getElementById('jobName').value,
        jobDescription: document.getElementById('jobDescription').value,
        scheduleStatus: document.getElementById('scheduleStatus').value,
        scheduleFrequency: document.getElementById('scheduleFrequency').value,
        scheduleTime: document.getElementById('scheduleTime').value,
        scheduleStartDate: document.getElementById('scheduleStartDate').value,
        scheduleEndDate: document.getElementById('scheduleEndDate').value,
        oracleBaseUrl: document.getElementById('oracleBaseUrl').value,
        oracleUsername: document.getElementById('oracleUsername').value,
        oraclePassword: document.getElementById('oraclePassword').value,
        parameters: document.getElementById('parameters').value,
        notificationEmail: document.getElementById('notificationEmail').value,
        maxRetries: parseInt(document.getElementById('maxRetries').value),
        retryOnFailure: document.getElementById('retryOnFailure').checked ? 'Y' : 'N',
        isActive: document.getElementById('isActive').checked ? 'Y' : 'N'
    };

    try {
        const response = await fetch(`${API_BASE_URL}/sync/jobs/header`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (result.status === 'SUCCESS' || response.ok) {
            showSuccess('Sync job saved successfully!');
            closeJobModal();
            loadConfiguredJobs(true);
        } else {
            showError('Error saving job: ' + result.message);
        }
    } catch (error) {
        console.error('Error saving job:', error);
        showError('Error saving job: ' + error.message);
    }
}

async function editJob(syncJobId) {
    try {
        const response = await fetch(`${API_BASE_URL}/sync/jobs/header/${syncJobId}`);
        const job = await response.json();

        document.getElementById('jobModalTitle').textContent = 'Edit Sync Job';
        document.getElementById('syncJobId').value = job.syncJobId;
        document.getElementById('jobMasterId').value = job.jobMasterId;
        document.getElementById('jobName').value = job.jobName;
        document.getElementById('jobDescription').value = job.jobDescription || '';
        document.getElementById('scheduleStatus').value = job.scheduleStatus;
        document.getElementById('scheduleFrequency').value = job.scheduleFrequency;
        document.getElementById('scheduleTime').value = job.scheduleTime || '';
        document.getElementById('scheduleStartDate').value = job.scheduleStartDate || '';
        document.getElementById('scheduleEndDate').value = job.scheduleEndDate || '';
        document.getElementById('oracleBaseUrl').value = job.oracleBaseUrl || '';
        document.getElementById('oracleUsername').value = job.oracleUsername || '';
        document.getElementById('oraclePassword').value = job.oraclePassword || '';
        document.getElementById('parameters').value = job.parameters || '';
        document.getElementById('notificationEmail').value = job.notificationEmail || '';
        document.getElementById('maxRetries').value = job.maxRetries || 3;
        document.getElementById('retryOnFailure').checked = job.retryOnFailure === 'Y';
        document.getElementById('isActive').checked = job.isActive === 'Y';

        await populateJobMasterDropdown();
        document.getElementById('jobModal').classList.add('active');
    } catch (error) {
        console.error('Error loading job for edit:', error);
        showError('Error loading job: ' + error.message);
    }
}

async function runJob(syncJobId) {
    if (!confirm('Are you sure you want to run this job now?')) {
        return;
    }

    try {
        showSuccess('Starting job execution...');

        const response = await fetch(`${API_BASE_URL}/sync/jobs/execute/${syncJobId}`, {
            method: 'POST'
        });

        const result = await response.json();

        if (result.status === 'SUCCESS' || response.ok) {
            showSuccess('Job execution started successfully!');
            setTimeout(() => {
                loadExecutionHistory(true);
                loadConfiguredJobs(true);
            }, 2000);
        } else {
            showError('Error starting job: ' + result.message);
        }
    } catch (error) {
        console.error('Error running job:', error);
        showError('Error running job: ' + error.message);
    }
}

async function deleteJob(syncJobId) {
    if (!confirm('Are you sure you want to delete this job? This action cannot be undone.')) {
        return;
    }

    try {
        // Note: You might need to implement a DELETE endpoint
        showError('Delete functionality not yet implemented in API');
    } catch (error) {
        console.error('Error deleting job:', error);
        showError('Error deleting job: ' + error.message);
    }
}

function viewJobHistory(syncJobId) {
    // Switch to history tab and filter by this job
    document.querySelector('[data-tab="execution-history"]').click();

    setTimeout(() => {
        // Filter history for this job
        const historyRows = document.querySelectorAll('#historyBody tr');
        historyRows.forEach(row => {
            const jobIdAttr = row.getAttribute('data-job-id');
            if (jobIdAttr && jobIdAttr !== syncJobId.toString()) {
                row.style.display = 'none';
            }
        });
    }, 500);
}

async function viewExecutionDetails(executionId) {
    try {
        const response = await fetch(`${API_BASE_URL}/sync/jobs/details/${executionId}`);
        const exec = await response.json();

        const detailsHtml = `
            <div class="form-group">
                <label>Execution ID:</label>
                <p>${exec.executionId}</p>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Job Name:</label>
                    <p>${exec.jobName}</p>
                </div>
                <div class="form-group">
                    <label>Module:</label>
                    <p>${exec.module}</p>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Start Time:</label>
                    <p>${formatDateTime(exec.startTime)}</p>
                </div>
                <div class="form-group">
                    <label>End Time:</label>
                    <p>${exec.endTime ? formatDateTime(exec.endTime) : 'Running...'}</p>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Duration:</label>
                    <p>${exec.durationSeconds ? exec.durationSeconds + ' seconds' : 'N/A'}</p>
                </div>
                <div class="form-group">
                    <label>Status:</label>
                    <p>${getExecutionStatusBadge(exec.syncStatus)}</p>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Fetched Records:</label>
                    <p>${exec.fetchedRecords || 0}</p>
                </div>
                <div class="form-group">
                    <label>Synced Records:</label>
                    <p>${exec.syncedRecords || 0}</p>
                </div>
            </div>
            <div class="form-group">
                <label>Error Records:</label>
                <p>${exec.errorRecords || 0}</p>
            </div>
            ${exec.errorMessage ? `
            <div class="form-group">
                <label>Error Message:</label>
                <p style="color: #e74c3c;">${exec.errorMessage}</p>
            </div>
            ` : ''}
            ${exec.parameters ? `
            <div class="form-group">
                <label>Parameters:</label>
                <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto;">${exec.parameters}</pre>
            </div>
            ` : ''}
            <div class="form-group">
                <label>Triggered By:</label>
                <p>${exec.triggeredBy} (${exec.triggeredByUser})</p>
            </div>
        `;

        document.getElementById('executionDetails').innerHTML = detailsHtml;
        document.getElementById('executionModal').classList.add('active');
    } catch (error) {
        console.error('Error loading execution details:', error);
        showError('Error loading execution details: ' + error.message);
    }
}

// ============================================================================
// MODAL FUNCTIONS
// ============================================================================

function closeJobModal() {
    document.getElementById('jobModal').classList.remove('active');
}

function closeExecutionModal() {
    document.getElementById('executionModal').classList.remove('active');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getStatusBadge(status) {
    const badges = {
        'ACTIVE': '<span class="badge badge-success">Active</span>',
        'INACTIVE': '<span class="badge badge-secondary">Inactive</span>',
        'PAUSED': '<span class="badge badge-warning">Paused</span>'
    };
    return badges[status] || '<span class="badge badge-secondary">' + status + '</span>';
}

function getExecutionStatusBadge(status) {
    const badges = {
        'SUCCESS': '<span class="badge badge-success">Success</span>',
        'FAILED': '<span class="badge badge-danger">Failed</span>',
        'RUNNING': '<span class="badge badge-info">Running</span>',
        'PARTIAL': '<span class="badge badge-warning">Partial</span>'
    };
    return badges[status] || '<span class="badge badge-secondary">' + status + '</span>';
}

function formatDateTime(dateTimeString) {
    if (!dateTimeString) return 'N/A';
    const date = new Date(dateTimeString);
    return date.toLocaleString();
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';

    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    successDiv.textContent = message;
    successDiv.style.display = 'block';

    setTimeout(() => {
        successDiv.style.display = 'none';
    }, 3000);
}

// Close modals when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
};

-- =====================================================
-- RR SYNC JOBS - APEX Page Structure
-- Part of Sync Module
-- =====================================================
-- Purpose: Guide for creating Sync Jobs page in APEX
-- Author: Claude Code
-- Date: 2025-11-10
-- =====================================================

/*
=====================================================
APEX PAGE CREATION GUIDE - SYNC JOBS
=====================================================

This guide provides the structure for creating a Sync Jobs management page in Oracle APEX.

PAGE DETAILS:
-------------
- Page Number: [Next available in Sync module]
- Page Name: Sync Jobs
- Page Mode: Normal
- Page Template: Theme Default
- Navigation: Add to Sync module menu

=====================================================
REGION 1: SYNC JOBS MASTER (Master Jobs Catalog)
=====================================================

Region Type: Interactive Report
Region Title: Available Sync Job Types
SQL Query:
*/

SELECT
    m.JOB_MASTER_ID as "ID",
    m.MODULE as "Module",
    m.JOB_NAME as "Job Name",
    m.JOB_CODE as "Job Code",
    m.SOURCE_ENDPOINT as "Source Endpoint",
    m.API_TYPE as "API Type",
    m.DESCRIPTION as "Description",
    CASE WHEN m.IS_ACTIVE = 'Y' THEN '✓' ELSE '✗' END as "Active",
    '<button class="t-Button t-Button--icon t-Button--iconLeft" onclick="createJobFromMaster(' || m.JOB_MASTER_ID || ')">
        <span class="t-Icon fa fa-plus"></span> Create Job
    </button>' as "Actions"
FROM RR_SYNC_JOBS_MASTER m
WHERE m.IS_ACTIVE = 'Y'
ORDER BY m.MODULE, m.SORT_ORDER, m.JOB_NAME;

/*
Region Properties:
- Show: Always
- Sequence: 10
- Column: Automatic

Interactive Report Settings:
- Enable Search Bar: Yes
- Enable Actions Menu: Yes
- Enable Download: CSV, HTML, PDF
- Rows Per Page: 15
- Pagination: Row Ranges X to Y of Z
*/

/*
=====================================================
REGION 2: CONFIGURED SYNC JOBS (Job Instances)
=====================================================

Region Type: Interactive Grid
Region Title: Configured Sync Jobs
SQL Query:
*/

SELECT
    h.SYNC_JOB_ID,
    h.JOB_MASTER_ID,
    m.MODULE,
    m.JOB_NAME as MASTER_JOB_NAME,
    h.JOB_NAME,
    h.JOB_DESCRIPTION,
    h.SCHEDULE_STATUS,
    h.SCHEDULE_FREQUENCY,
    h.SCHEDULE_TIME,
    TO_CHAR(h.LAST_RUN_DATE, 'YYYY-MM-DD HH24:MI:SS') as LAST_RUN,
    TO_CHAR(h.NEXT_RUN_DATE, 'YYYY-MM-DD HH24:MI:SS') as NEXT_RUN,
    h.TOTAL_EXECUTIONS,
    h.SUCCESS_COUNT,
    h.FAILURE_COUNT,
    CASE
        WHEN h.TOTAL_EXECUTIONS = 0 THEN 0
        ELSE ROUND((h.SUCCESS_COUNT / h.TOTAL_EXECUTIONS) * 100, 1)
    END as SUCCESS_RATE,
    h.IS_ACTIVE,
    h.ORACLE_BASE_URL,
    h.SOURCE_ENDPOINT,
    h.DESTINATION_ENDPOINT,
    h.ORACLE_USERNAME,
    h.ORACLE_PASSWORD,
    h.PARAMETERS,
    h.NOTIFICATION_EMAIL,
    h.RETRY_ON_FAILURE,
    h.MAX_RETRIES
FROM RR_SYNC_JOBS_HEADER h
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
ORDER BY h.CREATED_DATE DESC;

/*
Region Properties:
- Show: Always
- Sequence: 20
- Column: Automatic

Interactive Grid Settings:
- Editable: Yes
- Edit Mode: Row
- Enable Add Row: Yes
- Enable Delete Row: Yes
- Lost Update Type: Row Values

Column Settings:
- SYNC_JOB_ID: Hidden, Primary Key
- JOB_MASTER_ID: Select List (query: SELECT JOB_NAME, JOB_MASTER_ID FROM RR_SYNC_JOBS_MASTER WHERE IS_ACTIVE='Y' ORDER BY MODULE, JOB_NAME)
- MODULE: Display Only
- JOB_NAME: Text Field, Required
- SCHEDULE_STATUS: Select List (ACTIVE, INACTIVE, PAUSED)
- SCHEDULE_FREQUENCY: Select List (HOURLY, DAILY, WEEKLY, MONTHLY, MANUAL)
- IS_ACTIVE: Select List (Y, N)
- Success columns: Display Only
- Password: Text Field (password type)

Toolbar Buttons:
1. Run Selected Job
2. View Execution History
3. Export Configuration
*/

/*
=====================================================
REGION 3: JOB EXECUTION HISTORY
=====================================================

Region Type: Interactive Report
Region Title: Execution History
SQL Query:
*/

SELECT
    d.EXECUTION_ID,
    d.SYNC_JOB_ID,
    h.JOB_NAME,
    m.MODULE,
    TO_CHAR(d.START_TIME, 'YYYY-MM-DD HH24:MI:SS') as "Start Time",
    TO_CHAR(d.END_TIME, 'YYYY-MM-DD HH24:MI:SS') as "End Time",
    d.DURATION_SECONDS as "Duration (sec)",
    d.FETCHED_RECORDS as "Fetched",
    d.SYNCED_RECORDS as "Synced",
    d.ERROR_RECORDS as "Errors",
    CASE d.SYNC_STATUS
        WHEN 'SUCCESS' THEN '<span class="t-Badge t-Badge--success">SUCCESS</span>'
        WHEN 'FAILED' THEN '<span class="t-Badge t-Badge--danger">FAILED</span>'
        WHEN 'RUNNING' THEN '<span class="t-Badge t-Badge--info">RUNNING</span>'
        WHEN 'PARTIAL' THEN '<span class="t-Badge t-Badge--warning">PARTIAL</span>'
    END as "Status",
    d.ERROR_MESSAGE as "Error",
    d.TRIGGERED_BY as "Triggered By",
    d.TRIGGERED_BY_USER as "User",
    '<button class="t-Button t-Button--small" onclick="viewExecutionDetails(' || d.EXECUTION_ID || ')">
        <span class="t-Icon fa fa-search"></span> Details
    </button>' as "Actions"
FROM RR_SYNC_JOBS_DETAILS d
JOIN RR_SYNC_JOBS_HEADER h ON d.SYNC_JOB_ID = h.SYNC_JOB_ID
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE (:P_SYNC_JOB_ID IS NULL OR d.SYNC_JOB_ID = :P_SYNC_JOB_ID)
    AND (:P_MODULE IS NULL OR m.MODULE = :P_MODULE)
    AND (:P_STATUS IS NULL OR d.SYNC_STATUS = :P_STATUS)
    AND (:P_START_DATE IS NULL OR d.START_DATE >= TO_DATE(:P_START_DATE, 'YYYY-MM-DD'))
    AND (:P_END_DATE IS NULL OR d.START_DATE <= TO_DATE(:P_END_DATE, 'YYYY-MM-DD'))
ORDER BY d.START_TIME DESC;

/*
Region Properties:
- Show: Always
- Sequence: 30
- Column: Automatic

Interactive Report Settings:
- Enable Chart: Yes (Bar chart by Status)
- Enable Pivot: Yes
- Download Formats: CSV, HTML, PDF
- Rows Per Page: 25

Filter Items (above region):
- P_SYNC_JOB_ID: Select List (Dynamic LOV from RR_SYNC_JOBS_HEADER)
- P_MODULE: Select List (Static: GL, AP, AR, INV)
- P_STATUS: Select List (Static: SUCCESS, FAILED, RUNNING, PARTIAL)
- P_START_DATE: Date Picker
- P_END_DATE: Date Picker
*/

/*
=====================================================
REGION 4: SYNC STATISTICS DASHBOARD
=====================================================

Region Type: Static Content
Region Title: Sync Statistics
SQL Query (for chart):
*/

SELECT
    m.MODULE,
    SUM(h.TOTAL_EXECUTIONS) as TOTAL_EXECUTIONS,
    SUM(h.SUCCESS_COUNT) as SUCCESS_COUNT,
    SUM(h.FAILURE_COUNT) as FAILURE_COUNT,
    CASE
        WHEN SUM(h.TOTAL_EXECUTIONS) = 0 THEN 0
        ELSE ROUND((SUM(h.SUCCESS_COUNT) / SUM(h.TOTAL_EXECUTIONS)) * 100, 1)
    END as SUCCESS_RATE
FROM RR_SYNC_JOBS_HEADER h
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
GROUP BY m.MODULE
ORDER BY m.MODULE;

/*
Add Chart:
- Chart Type: Bar
- X-Axis: MODULE
- Y-Axis: SUCCESS_COUNT, FAILURE_COUNT
- Orientation: Vertical
- Show Values: Yes
- Show Legend: Yes
*/

/*
=====================================================
PAGE ITEMS
=====================================================

Create the following page items:

1. P_SYNC_JOB_ID
   - Type: Select List
   - Label: Sync Job
   - LOV Query: SELECT JOB_NAME, SYNC_JOB_ID FROM RR_SYNC_JOBS_HEADER ORDER BY JOB_NAME
   - Display Null Value: Yes
   - Null Display Value: - All Jobs -

2. P_MODULE
   - Type: Select List
   - Label: Module
   - Static Values: GL, AP, AR, INV
   - Display Null Value: Yes
   - Null Display Value: - All Modules -

3. P_STATUS
   - Type: Select List
   - Label: Status
   - Static Values: SUCCESS, FAILED, RUNNING, PARTIAL
   - Display Null Value: Yes
   - Null Display Value: - All Statuses -

4. P_START_DATE
   - Type: Date Picker
   - Label: From Date
   - Format: YYYY-MM-DD

5. P_END_DATE
   - Type: Date Picker
   - Label: To Date
   - Format: YYYY-MM-DD

=====================================================
BUTTONS
=====================================================

1. RUN_JOB
   - Label: Run Job
   - Button Template: Icon
   - Icon: fa-play
   - Hot: Yes
   - Action: Execute Server-side Code
   - PL/SQL Code:
*/

BEGIN
    RR_SYNC_JOBS_PKG.EXECUTE_SYNC_JOB(
        p_sync_job_id => :P_SYNC_JOB_ID,
        p_triggered_by => 'USER'
    );

    apex_application.g_print_success_message := 'Sync job executed successfully!';
EXCEPTION
    WHEN OTHERS THEN
        apex_error.add_error(
            p_message => 'Error executing sync job: ' || SQLERRM,
            p_display_location => apex_error.c_inline_in_notification
        );
END;

/*
2. REFRESH
   - Label: Refresh
   - Button Template: Icon
   - Icon: fa-refresh
   - Action: Refresh regions

3. CREATE_JOB
   - Label: Create New Job
   - Button Template: Icon
   - Icon: fa-plus
   - Hot: Yes
   - Action: Open modal dialog / form

=====================================================
DYNAMIC ACTIONS
=====================================================

1. DA: Refresh Execution History on Job Run
   - Event: After Refresh
   - Selection Type: Region
   - Region: Configured Sync Jobs
   - Action: Refresh Region (Execution History)

2. DA: Auto-refresh Running Jobs
   - Event: Page Load
   - Action: Execute JavaScript Code
   - Code:
*/

-- JavaScript for auto-refresh
setInterval(function() {
    apex.region('execution_history').refresh();
}, 30000); // Refresh every 30 seconds

/*
3. DA: Highlight Failed Jobs
   - Event: After Refresh
   - Selection Type: Region
   - Region: Execution History
   - Action: Execute JavaScript Code
   - Code:
*/

-- JavaScript to highlight failures
$('td:contains("FAILED")').closest('tr').addClass('error-row');

/*
=====================================================
MODAL PAGE: JOB EXECUTION DETAILS
=====================================================

Create a modal dialog page to show full execution details:

Page Type: Modal Dialog
Page Name: Execution Details
SQL Query:
*/

SELECT
    d.EXECUTION_ID,
    h.JOB_NAME,
    m.MODULE,
    m.JOB_CODE,
    TO_CHAR(d.START_TIME, 'YYYY-MM-DD HH24:MI:SS') as START_TIME,
    TO_CHAR(d.END_TIME, 'YYYY-MM-DD HH24:MI:SS') as END_TIME,
    d.DURATION_SECONDS,
    d.FETCHED_RECORDS,
    d.SYNCED_RECORDS,
    d.ERROR_RECORDS,
    d.FETCH_STATUS,
    d.SYNC_STATUS,
    d.PARAMETERS,
    d.ERROR_MESSAGE,
    d.ERROR_DETAILS,
    d.ORACLE_RESPONSE,
    d.SYNC_RESPONSE,
    d.RETRY_COUNT,
    d.TRIGGERED_BY,
    d.TRIGGERED_BY_USER
FROM RR_SYNC_JOBS_DETAILS d
JOIN RR_SYNC_JOBS_HEADER h ON d.SYNC_JOB_ID = h.SYNC_JOB_ID
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE d.EXECUTION_ID = :P_EXECUTION_ID;

/*
Display as Form with regions:
- Summary (display only fields)
- Parameters (CLOB display)
- Oracle Response (CLOB display, JSON formatted)
- Sync Response (CLOB display, JSON formatted)
- Error Details (CLOB display, if applicable)

=====================================================
CSS STYLING
=====================================================

Add to Page CSS:
*/

/* Sync Jobs Page Styling */
.error-row {
    background-color: #ffebee !important;
}

.success-badge {
    background-color: #4caf50;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
}

.failed-badge {
    background-color: #f44336;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
}

.running-badge {
    background-color: #2196f3;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
}

/* Dashboard Cards */
.sync-stat-card {
    background: #fff;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    margin-bottom: 20px;
}

.stat-value {
    font-size: 32px;
    font-weight: bold;
    color: #1976d2;
}

.stat-label {
    font-size: 14px;
    color: #666;
    text-transform: uppercase;
}

/*
=====================================================
JAVASCRIPT FUNCTIONS
=====================================================

Add to Page JavaScript:
*/

-- Function to execute sync job
function runSyncJob(syncJobId) {
    apex.server.process(
        'EXECUTE_SYNC_JOB',
        {
            x01: syncJobId
        },
        {
            success: function(data) {
                apex.message.showPageSuccess('Sync job started successfully!');
                apex.region('execution_history').refresh();
            },
            error: function(jqXHR, textStatus, errorThrown) {
                apex.message.showErrors([{
                    type: 'error',
                    message: 'Error starting sync job: ' + errorThrown
                }]);
            }
        }
    );
}

-- Function to view execution details
function viewExecutionDetails(executionId) {
    apex.navigation.dialog(
        'f?p=&APP_ID.:EXECUTION_DETAILS:&SESSION.::NO:RP:P_EXECUTION_ID:' + executionId,
        {
            title: 'Execution Details',
            height: '600',
            width: '800',
            maxWidth: '1200',
            modal: true,
            dialog: null
        },
        'a-Dialog--uiDialog',
        $('#apex_dialog_1')
    );
}

-- Function to create job from master
function createJobFromMaster(jobMasterId) {
    apex.navigation.dialog(
        'f?p=&APP_ID.:CREATE_JOB:&SESSION.::NO:RP:P_JOB_MASTER_ID:' + jobMasterId,
        {
            title: 'Create Sync Job',
            height: '500',
            width: '700',
            modal: true
        }
    );
}

/*
=====================================================
AUTHORIZATION
=====================================================

Create Authorization Scheme:
- Name: Sync Jobs Admin
- Type: PL/SQL Function Returning Boolean
- Code:
*/

RETURN APEX_UTIL.CURRENT_USER_IN_GROUP('SYNC_ADMIN');

/*
Apply to:
- Create/Edit Job buttons
- Delete Job action
- Run Job button

=====================================================
END OF APEX PAGE STRUCTURE
=====================================================
*/

PROMPT
PROMPT =====================================================
PROMPT APEX Page Structure Guide Created!
PROMPT =====================================================
PROMPT
PROMPT Follow the instructions above to create the Sync Jobs page in APEX
PROMPT
PROMPT Key Features:
PROMPT - Master Jobs Catalog (view available sync types)
PROMPT - Configure Job Instances (create and manage sync jobs)
PROMPT - Execution History (monitor job runs)
PROMPT - Statistics Dashboard (view success rates)
PROMPT - Real-time Job Execution (run jobs manually)
PROMPT - Auto-refresh for running jobs
PROMPT
PROMPT Page should be added to the Sync module menu
PROMPT =====================================================

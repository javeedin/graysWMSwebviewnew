-- ============================================================================
-- RR GL JOURNAL BATCHES - COMPLETE SETUP GUIDE
-- ============================================================================
-- Description: Complete setup guide for GL Journal Batch sync
-- Base URL: https://efmh.fa.em3.oraclecloud.com
-- API Path: /fscmRestApi/resources/11.13.18.05/journalBatches
-- Created: 2025-11-10
-- ============================================================================

/*
╔══════════════════════════════════════════════════════════════════════════╗
║                     INSTALLATION INSTRUCTIONS                              ║
╚══════════════════════════════════════════════════════════════════════════╝

STEP 1: CREATE DATABASE OBJECTS
--------------------------------
Run the following scripts in order:

    1. @01_rr_gl_journal_batches_table.sql  -- Create table and sequence
    2. @02_rr_gl_journal_batches_POST.sql   -- Create POST endpoint
    3. @03_rr_gl_journal_batches_GET.sql    -- Create GET endpoints
    4. @04_rr_gl_package.sql                -- Create PL/SQL package

STEP 2: VERIFY INSTALLATION
----------------------------
Run this query to verify:
*/

SELECT
    'RR_GL_JOURNAL_BATCHES' as object_name,
    object_type,
    status
FROM user_objects
WHERE object_name IN (
    'RR_GL_JOURNAL_BATCHES',
    'RR_GL_JOURNAL_BATCHES_SEQ',
    'RR_GL_SYNC_JOURNAL_BATCH',
    'RR_GL_PKG'
)
ORDER BY object_type, object_name;

/*
Expected Results:
- TABLE          RR_GL_JOURNAL_BATCHES         VALID
- SEQUENCE       RR_GL_JOURNAL_BATCHES_SEQ     VALID
- PROCEDURE      RR_GL_SYNC_JOURNAL_BATCH      VALID
- PACKAGE        RR_GL_PKG                     VALID
- PACKAGE BODY   RR_GL_PKG                     VALID

STEP 3: VERIFY ORDS ENDPOINTS
------------------------------
Check if all endpoints are registered:
*/

SELECT
    name,
    template,
    method,
    source_type
FROM user_ords_handlers
WHERE module_name = 'rr.gl'
ORDER BY template, method;

/*
Expected Results:
- bulksync          POST    PLSQL
- journalbatches    GET     QUERY
- journalbatches    POST    PLSQL
- journalbatches/:id GET    QUERY_ONE_ROW
- stats             GET     PLSQL

╔══════════════════════════════════════════════════════════════════════════╗
║                         API ENDPOINTS                                      ║
╚══════════════════════════════════════════════════════════════════════════╝

BASE URL
--------
https://your-apex-instance.com/ords/WORKSPACE/SCHEMA/rr/gl/

AVAILABLE ENDPOINTS
-------------------

1. POST /journalbatches
   Description: Sync single journal batch from Oracle Fusion
   Request Body: JSON object with journal batch data
   Example:
   {
       "JeBatchId": 8537967,
       "DefaultPeriodName": "May-23",
       "BatchName": "Manual 8438967...",
       "Status": "P",
       "PostedDate": "2023-06-11",
       ...
   }

2. POST /bulksync
   Description: Sync multiple journal batches
   Request Body: JSON array of journal batch objects
   Example:
   [
       { "JeBatchId": 8537967, ... },
       { "JeBatchId": 8537968, ... }
   ]

3. GET /journalbatches
   Description: Get all synced journal batches with filters
   Query Parameters:
   - limit: Number of records (default: all)
   - offset: Skip N records (default: 0)
   - period_name: Filter by period (e.g., "May-23")
   - status: Filter by status (e.g., "P" for Posted)
   - sync_status: Filter by sync status (SYNCED, PENDING, ERROR)
   - je_batch_id: Filter by Oracle batch ID
   - search: Search in batch name/description

   Examples:
   /journalbatches?limit=100&offset=0
   /journalbatches?period_name=May-23
   /journalbatches?status=P&sync_status=SYNCED
   /journalbatches?search=TERRA

4. GET /journalbatches/:id
   Description: Get single journal batch by local sync ID
   Example: /journalbatches/123

5. GET /stats
   Description: Get sync statistics
   Response:
   {
       "totalBatches": 500,
       "syncedBatches": 495,
       "errorBatches": 5,
       "pendingBatches": 0,
       "lastSyncDate": "2025-11-10T16:30:00+00:00",
       "totalDebit": 12345678.90,
       "totalCredit": 12345678.90,
       "postedBatches": 490,
       "unpostedBatches": 10
   }

╔══════════════════════════════════════════════════════════════════════════╗
║                    ORACLE FUSION INTEGRATION                               ║
╚══════════════════════════════════════════════════════════════════════════╝

FUSION API DETAILS
------------------
Base URL: https://efmh.fa.em3.oraclecloud.com
API Path: /fscmRestApi/resources/11.13.18.05/journalBatches
Full URL: https://efmh.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/journalBatches

AUTHENTICATION
--------------
Oracle Fusion uses Basic Authentication or OAuth 2.0

Sample cURL Request:
curl -X GET \
  'https://efmh.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/journalBatches?limit=100' \
  -H 'Authorization: Basic BASE64_ENCODED_CREDENTIALS' \
  -H 'Accept: application/json'

FIELD MAPPING
-------------
Oracle Fusion Field          → Local DB Column
-------------------            -----------------
JeBatchId                   → JE_BATCH_ID
AccountedPeriodType         → ACCOUNTED_PERIOD_TYPE
DefaultPeriodName           → DEFAULT_PERIOD_NAME
BatchName                   → BATCH_NAME
Status                      → STATUS
ControlTotal                → CONTROL_TOTAL
BatchDescription            → BATCH_DESCRIPTION
ErrorMessage                → ERROR_MESSAGE
PostedDate                  → POSTED_DATE
PostingRunId                → POSTING_RUN_ID
RequestId                   → REQUEST_ID
RunningTotalAccountedCr     → RUNNING_TOTAL_ACCT_CR
RunningTotalAccountedDr     → RUNNING_TOTAL_ACCT_DR
RunningTotalCr              → RUNNING_TOTAL_CR
RunningTotalDr              → RUNNING_TOTAL_DR
CreatedBy                   → ORACLE_CREATED_BY
CreationDate                → ORACLE_CREATION_DATE
LastUpdateDate              → ORACLE_LAST_UPDATE_DATE
LastUpdatedBy               → ORACLE_LAST_UPDATED_BY
ActualFlagMeaning           → ACTUAL_FLAG_MEANING
ApprovalStatusMeaning       → APPROVAL_STATUS_MEANING
ApproverEmployeeName        → APPROVER_EMPLOYEE_NAME
FundsStatusMeaning          → FUNDS_STATUS_MEANING
ParentJeBatchName           → PARENT_JE_BATCH_NAME
ChartOfAccountsName         → CHART_OF_ACCOUNTS_NAME
StatusMeaning               → STATUS_MEANING
CompletionStatusMeaning     → COMPLETION_STATUS_MEANING
UserPeriodSetName           → USER_PERIOD_SET_NAME
UserJeSourceName            → USER_JE_SOURCE_NAME
ReversalDate                → REVERSAL_DATE
ReversalPeriod              → REVERSAL_PERIOD
ReversalFlag                → REVERSAL_FLAG
ReversalMethodMeaning       → REVERSAL_METHOD_MEANING

╔══════════════════════════════════════════════════════════════════════════╗
║                         TESTING GUIDE                                      ║
╚══════════════════════════════════════════════════════════════════════════╝

TEST 1: INSERT SAMPLE DATA
---------------------------
*/

BEGIN
    RR_GL_SYNC_JOURNAL_BATCH(
        p_je_batch_id               => 8537967,
        p_accounted_period_type     => 'MONTH0673801413',
        p_default_period_name       => 'May-23',
        p_batch_name                => 'Manual 8438967 10-MAY-2023 15:34:30',
        p_status                    => 'P',
        p_control_total             => NULL,
        p_batch_description         => 'TERRA FINANCE INTEREST APR 2023',
        p_error_message             => NULL,
        p_posted_date               => '2023-06-11',
        p_posting_run_id            => 7390496,
        p_request_id                => 12412358,
        p_running_total_acct_cr     => 60335301.37,
        p_running_total_acct_dr     => 60335301.37,
        p_running_total_cr          => 60335301.37,
        p_running_total_dr          => 60335301.37,
        p_oracle_created_by         => 'elintelligent',
        p_oracle_creation_date      => '2023-06-11T14:10:40+00:00',
        p_oracle_last_update_date   => '2023-06-11T15:05:33+00:00',
        p_oracle_last_updated_by    => 'elintelligent',
        p_actual_flag_meaning       => 'Actual',
        p_approval_status_meaning   => 'Approved',
        p_approver_employee_name    => 'WONG, Ludovic',
        p_funds_status_meaning      => 'Not applicable',
        p_parent_je_batch_name      => NULL,
        p_chart_of_accounts_name    => 'GRCOA',
        p_status_meaning            => 'Posted',
        p_completion_status_meaning => 'Complete',
        p_user_period_set_name      => 'GRCOA',
        p_user_je_source_name       => 'AutoCopy',
        p_reversal_date             => NULL,
        p_reversal_period           => NULL,
        p_reversal_flag             => NULL,
        p_reversal_method_meaning   => NULL,
        p_result                    => :result,
        p_message                   => :message
    );

    DBMS_OUTPUT.PUT_LINE('Result: ' || :result);
    DBMS_OUTPUT.PUT_LINE('Message: ' || :message);
END;
/

/*
TEST 2: QUERY SYNCED DATA
--------------------------
*/

SELECT
    BATCH_SYNC_ID,
    JE_BATCH_ID,
    DEFAULT_PERIOD_NAME,
    BATCH_NAME,
    STATUS_MEANING,
    RUNNING_TOTAL_DR,
    RUNNING_TOTAL_CR,
    POSTED_DATE,
    SYNC_STATUS
FROM RR_GL_JOURNAL_BATCHES
ORDER BY POSTED_DATE DESC;

/*
TEST 3: GET STATISTICS
----------------------
*/

SELECT RR_GL_PKG.GET_SYNC_STATS FROM DUAL;

/*
TEST 4: GET BATCHES BY PERIOD
------------------------------
*/

SELECT RR_GL_PKG.GET_BATCHES_BY_PERIOD('May-23') FROM DUAL;

/*
╔══════════════════════════════════════════════════════════════════════════╗
║                        MAINTENANCE TASKS                                   ║
╚══════════════════════════════════════════════════════════════════════════╝

CLEANUP OLD DATA
----------------
Delete synced batches older than 90 days:
*/

DECLARE
    v_deleted NUMBER;
BEGIN
    RR_GL_PKG.CLEANUP_OLD_BATCHES(
        p_days_old => 90,
        p_deleted  => v_deleted
    );
    DBMS_OUTPUT.PUT_LINE('Deleted ' || v_deleted || ' old batches');
END;
/

/*
MARK BATCH AS ERROR
-------------------
*/

BEGIN
    RR_GL_PKG.MARK_BATCH_ERROR(
        p_batch_sync_id => 123,
        p_error_message => 'Sync failed due to network timeout'
    );
END;
/

/*
REBUILD INDEXES
---------------
*/

ALTER INDEX RR_GL_JB_STATUS_IDX REBUILD;
ALTER INDEX RR_GL_JB_POSTED_DATE_IDX REBUILD;
ALTER INDEX RR_GL_JB_PERIOD_NAME_IDX REBUILD;
ALTER INDEX RR_GL_JB_SYNC_STATUS_IDX REBUILD;
ALTER INDEX RR_GL_JB_SYNC_DATE_IDX REBUILD;

/*
CHECK TABLE STATS
-----------------
*/

SELECT
    table_name,
    num_rows,
    blocks,
    avg_row_len,
    last_analyzed
FROM user_tables
WHERE table_name = 'RR_GL_JOURNAL_BATCHES';

/*
GATHER STATS
------------
*/

BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        ownname => USER,
        tabname => 'RR_GL_JOURNAL_BATCHES',
        estimate_percent => DBMS_STATS.AUTO_SAMPLE_SIZE,
        method_opt => 'FOR ALL COLUMNS SIZE AUTO',
        cascade => TRUE
    );
END;
/

/*
╔══════════════════════════════════════════════════════════════════════════╗
║                       TROUBLESHOOTING                                      ║
╚══════════════════════════════════════════════════════════════════════════╝

ISSUE: Date conversion errors
SOLUTION: Check date format in Oracle Fusion response
- Expected: "YYYY-MM-DD" for dates
- Expected: "YYYY-MM-DDTHH24:MI:SS+00:00" for timestamps

ISSUE: Duplicate JE_BATCH_ID error
SOLUTION: The procedure handles updates automatically
- If batch exists, it updates instead of inserting

ISSUE: NULL values in running totals
SOLUTION: This is normal if batch has no transactions yet

ISSUE: ORDS endpoint not found
SOLUTION: Verify module and template are defined:
*/

SELECT * FROM user_ords_modules WHERE name = 'rr.gl';
SELECT * FROM user_ords_templates WHERE module_name = 'rr.gl';

/*
ISSUE: Performance degradation
SOLUTION: Check if indexes need rebuild and gather stats

╔══════════════════════════════════════════════════════════════════════════╗
║                      SUPPORT INFORMATION                                   ║
╚══════════════════════════════════════════════════════════════════════════╝

Created: 2025-11-10
Version: 1.0
Author: RR Development Team
Naming Convention: RR_ prefix for all objects

For questions or issues, contact your database administrator.

============================================================================
END OF SETUP GUIDE
============================================================================
*/

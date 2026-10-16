-- =====================================================
-- RR SYNC JOBS - COMPLETE SETUP GUIDE
-- Part of Sync Module
-- =====================================================
-- Purpose: Complete installation and testing guide
-- Author: Claude Code
-- Date: 2025-11-10
-- =====================================================

/*
=====================================================
INSTALLATION INSTRUCTIONS
=====================================================

STEP 1: Install Database Objects
---------------------------------
Run the following scripts in order in Oracle APEX SQL Workshop:

@apex_sql/sync/01_rr_sync_jobs_tables.sql
@apex_sql/sync/02_rr_sync_jobs_master_handlers.sql
@apex_sql/sync/03_rr_sync_jobs_header_handlers.sql
@apex_sql/sync/04_rr_sync_jobs_details_handlers.sql
@apex_sql/sync/05_rr_sync_jobs_package.sql

STEP 2: Verify Installation
----------------------------
Run the verification queries below to ensure all objects are created.

STEP 3: Create APEX Page
-------------------------
Follow the instructions in:
@apex_sql/sync/06_rr_sync_jobs_apex_page.sql

STEP 4: Load Sample Master Jobs
--------------------------------
Sample master jobs are already loaded from step 1.
Add more master jobs as needed (see examples below).

STEP 5: Configure Network Access (Important!)
----------------------------------------------
Grant network access to Oracle Fusion URL:
*/

BEGIN
    DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE(
        host => 'efmh.fa.em3.oraclecloud.com',
        ace  => xs$ace_type(
            privilege_list => xs$name_list('connect', 'resolve'),
            principal_name => 'WKSP_GRAYSAPP',
            principal_type => xs_acl.ptype_db
        )
    );
    COMMIT;
END;
/

-- Also grant access to your local ORDS endpoint
BEGIN
    DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE(
        host => 'localhost',
        ace  => xs$ace_type(
            privilege_list => xs$name_list('connect', 'resolve'),
            principal_name => 'WKSP_GRAYSAPP',
            principal_type => xs_acl.ptype_db
        )
    );
    COMMIT;
END;
/

/*
=====================================================
VERIFICATION QUERIES
=====================================================
*/

-- Check all tables exist
SELECT 'RR_SYNC_JOBS_MASTER' as table_name, COUNT(*) as record_count
FROM RR_SYNC_JOBS_MASTER
UNION ALL
SELECT 'RR_SYNC_JOBS_HEADER', COUNT(*)
FROM RR_SYNC_JOBS_HEADER
UNION ALL
SELECT 'RR_SYNC_JOBS_DETAILS', COUNT(*)
FROM RR_SYNC_JOBS_DETAILS;

-- Check ORDS endpoints
SELECT module, uri_template, handler_type
FROM USER_ORDS_HANDLERS
WHERE module = 'rr'
    AND uri_template LIKE '%sync/jobs%'
ORDER BY uri_template;

-- Check package exists
SELECT object_name, object_type, status
FROM USER_OBJECTS
WHERE object_name = 'RR_SYNC_JOBS_PKG';

/*
=====================================================
SAMPLE DATA - ADDITIONAL MASTER JOBS
=====================================================
*/

-- Add AP Invoices sync job
INSERT INTO RR_SYNC_JOBS_MASTER (
    JOB_MASTER_ID,
    MODULE,
    JOB_NAME,
    JOB_CODE,
    SOURCE_ENDPOINT,
    DESTINATION_ENDPOINT,
    API_TYPE,
    HTTP_METHOD,
    DESTINATION_PROCEDURE,
    DEFAULT_PARAMETERS,
    DESCRIPTION,
    IS_ACTIVE,
    SORT_ORDER
) VALUES (
    RR_SYNC_JOBS_MASTER_SEQ.NEXTVAL,
    'AP',
    'AP Invoices',
    'AP_INVOICES',
    '/fscmRestApi/resources/11.13.18.05/invoices',
    '/ords/r/wksp_graysapp/rr/ap/invoices',
    'REST',
    'GET',
    'RR_AP_SYNC_INVOICE',
    '{"limit": 500, "offset": 0}',
    'Sync AP Invoices from Oracle Fusion to APEX',
    'Y',
    200
);

-- Add AR Receipts sync job
INSERT INTO RR_SYNC_JOBS_MASTER (
    JOB_MASTER_ID,
    MODULE,
    JOB_NAME,
    JOB_CODE,
    SOURCE_ENDPOINT,
    DESTINATION_ENDPOINT,
    API_TYPE,
    HTTP_METHOD,
    DESTINATION_PROCEDURE,
    DEFAULT_PARAMETERS,
    DESCRIPTION,
    IS_ACTIVE,
    SORT_ORDER
) VALUES (
    RR_SYNC_JOBS_MASTER_SEQ.NEXTVAL,
    'AR',
    'AR Receipts',
    'AR_RECEIPTS',
    '/fscmRestApi/resources/11.13.18.05/standardReceipts',
    '/ords/r/wksp_graysapp/rr/ar/receipts',
    'REST',
    'GET',
    'RR_AR_SYNC_RECEIPT',
    '{"limit": 500, "offset": 0}',
    'Sync AR Receipts from Oracle Fusion to APEX',
    'Y',
    300
);

-- Add Inventory Items sync job
INSERT INTO RR_SYNC_JOBS_MASTER (
    JOB_MASTER_ID,
    MODULE,
    JOB_NAME,
    JOB_CODE,
    SOURCE_ENDPOINT,
    DESTINATION_ENDPOINT,
    API_TYPE,
    HTTP_METHOD,
    DESTINATION_PROCEDURE,
    DEFAULT_PARAMETERS,
    DESCRIPTION,
    IS_ACTIVE,
    SORT_ORDER
) VALUES (
    RR_SYNC_JOBS_MASTER_SEQ.NEXTVAL,
    'INV',
    'Inventory Items',
    'INV_ITEMS',
    '/fscmRestApi/resources/11.13.18.05/items',
    '/ords/r/wksp_graysapp/rr/inv/items',
    'REST',
    'GET',
    'RR_INV_SYNC_ITEM',
    '{"limit": 1000, "offset": 0}',
    'Sync Inventory Items from Oracle Fusion to APEX',
    'Y',
    400
);

COMMIT;

/*
=====================================================
EXAMPLE: CREATE SYNC JOB INSTANCE
=====================================================
*/

-- Create a GL Journal Batches sync job for May 2023
DECLARE
    v_sync_job_id NUMBER;
BEGIN
    v_sync_job_id := RR_SYNC_JOBS_HEADER_SEQ.NEXTVAL;

    INSERT INTO RR_SYNC_JOBS_HEADER (
        SYNC_JOB_ID,
        JOB_MASTER_ID,
        JOB_NAME,
        JOB_DESCRIPTION,
        ORACLE_BASE_URL,
        ORACLE_USERNAME,
        ORACLE_PASSWORD,
        PARAMETERS,
        SCHEDULE_STATUS,
        SCHEDULE_FREQUENCY,
        SCHEDULE_START_DATE,
        SCHEDULE_TIME,
        IS_ACTIVE,
        NOTIFICATION_EMAIL,
        RETRY_ON_FAILURE,
        MAX_RETRIES
    ) VALUES (
        v_sync_job_id,
        1, -- GL Journal Batches master job
        'Daily GL Sync - May 2023',
        'Automatically sync GL journal batches for May 2023 period',
        'https://efmh.fa.em3.oraclecloud.com',
        'your_username',
        'your_password', -- In production, encrypt this!
        '{"period_name": "May-23", "status": "P"}',
        'ACTIVE',
        'DAILY',
        SYSDATE,
        '02:00',
        'Y',
        'admin@company.com',
        'Y',
        3
    );

    COMMIT;

    DBMS_OUTPUT.PUT_LINE('Sync job created with ID: ' || v_sync_job_id);
END;
/

/*
=====================================================
TESTING GUIDE
=====================================================

TEST 1: Test Master Job Endpoints
----------------------------------
*/

-- Get all master jobs
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/master

-- Get GL master jobs only
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/master?module=GL

-- Get specific master job
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/master/1

-- Create new master job via POST
-- POST /ords/r/wksp_graysapp/rr/sync/jobs/master
-- Body:
/*
{
  "module": "PO",
  "jobName": "Purchase Orders",
  "jobCode": "PO_PURCHASE_ORDERS",
  "sourceEndpoint": "/fscmRestApi/resources/11.13.18.05/purchaseOrders",
  "apiType": "REST",
  "httpMethod": "GET",
  "description": "Sync Purchase Orders from Oracle Fusion",
  "isActive": "Y"
}
*/

/*
TEST 2: Test Header Job Endpoints
----------------------------------
*/

-- Get all configured jobs
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/header

-- Get jobs for specific module
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/header?module=GL

-- Get active jobs only
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/header?is_active=Y&schedule_status=ACTIVE

-- Get jobs due for execution
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/header/due

-- Create new job via POST
-- POST /ords/r/wksp_graysapp/rr/sync/jobs/header
-- Body:
/*
{
  "jobMasterId": 1,
  "jobName": "Weekly GL Sync",
  "jobDescription": "Weekly sync of all GL batches",
  "oracleBaseUrl": "https://efmh.fa.em3.oraclecloud.com",
  "oracleUsername": "your_username",
  "oraclePassword": "your_password",
  "parameters": "{\"limit\": 500}",
  "scheduleStatus": "ACTIVE",
  "scheduleFrequency": "WEEKLY",
  "scheduleTime": "03:00",
  "isActive": "Y",
  "retryOnFailure": "Y",
  "maxRetries": 3
}
*/

/*
TEST 3: Execute Sync Job Manually
----------------------------------
*/

-- Execute job ID 1
-- POST /ords/r/wksp_graysapp/rr/sync/jobs/execute/1

-- Or via PL/SQL:
BEGIN
    RR_SYNC_JOBS_PKG.EXECUTE_SYNC_JOB(
        p_sync_job_id => 1,
        p_triggered_by => 'USER'
    );
END;
/

/*
TEST 4: View Execution History
-------------------------------
*/

-- Get all execution logs
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/details

-- Get execution logs for specific job
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/details?sync_job_id=1

-- Get failed executions only
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/details?sync_status=FAILED

-- Get execution logs for date range
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/details?start_date=2023-05-01&end_date=2023-05-31

-- Get specific execution details
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/details/:execution_id

/*
TEST 5: View Statistics
------------------------
*/

-- Get job summary
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/summary/1

-- Get overall statistics
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/statistics

-- Get statistics for GL module
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/statistics?module=GL

-- Get execution statistics
-- GET /ords/r/wksp_graysapp/rr/sync/jobs/details/stats?sync_job_id=1

/*
TEST 6: Test Scheduler
-----------------------
*/

-- Execute all due jobs (would be called by DBMS_SCHEDULER)
BEGIN
    RR_SYNC_JOBS_PKG.EXECUTE_DUE_JOBS;
END;
/

/*
=====================================================
SCHEDULING SETUP
=====================================================

To automate sync jobs, create a DBMS_SCHEDULER job:
*/

BEGIN
    DBMS_SCHEDULER.CREATE_JOB(
        job_name        => 'RR_SYNC_JOBS_SCHEDULER',
        job_type        => 'PLSQL_BLOCK',
        job_action      => 'BEGIN RR_SYNC_JOBS_PKG.EXECUTE_DUE_JOBS; END;',
        start_date      => SYSTIMESTAMP,
        repeat_interval => 'FREQ=HOURLY; INTERVAL=1',
        enabled         => TRUE,
        comments        => 'Execute sync jobs that are due'
    );
END;
/

-- To check scheduler status
SELECT job_name, state, last_start_date, next_run_date, run_count, failure_count
FROM USER_SCHEDULER_JOBS
WHERE job_name = 'RR_SYNC_JOBS_SCHEDULER';

-- To disable scheduler
BEGIN
    DBMS_SCHEDULER.DISABLE('RR_SYNC_JOBS_SCHEDULER');
END;
/

-- To enable scheduler
BEGIN
    DBMS_SCHEDULER.ENABLE('RR_SYNC_JOBS_SCHEDULER');
END;
/

-- To drop scheduler
BEGIN
    DBMS_SCHEDULER.DROP_JOB('RR_SYNC_JOBS_SCHEDULER');
END;
/

/*
=====================================================
MONITORING QUERIES
=====================================================
*/

-- View all active jobs with next run times
SELECT
    h.SYNC_JOB_ID,
    h.JOB_NAME,
    m.MODULE,
    h.SCHEDULE_STATUS,
    h.SCHEDULE_FREQUENCY,
    TO_CHAR(h.LAST_RUN_DATE, 'YYYY-MM-DD HH24:MI:SS') as LAST_RUN,
    TO_CHAR(h.NEXT_RUN_DATE, 'YYYY-MM-DD HH24:MI:SS') as NEXT_RUN,
    h.TOTAL_EXECUTIONS,
    h.SUCCESS_COUNT,
    h.FAILURE_COUNT,
    CASE
        WHEN h.TOTAL_EXECUTIONS = 0 THEN 0
        ELSE ROUND((h.SUCCESS_COUNT / h.TOTAL_EXECUTIONS) * 100, 1)
    END as SUCCESS_RATE_PCT
FROM RR_SYNC_JOBS_HEADER h
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE h.IS_ACTIVE = 'Y'
ORDER BY h.NEXT_RUN_DATE NULLS LAST;

-- View recent execution summary
SELECT
    TO_CHAR(d.START_DATE, 'YYYY-MM-DD') as EXECUTION_DATE,
    m.MODULE,
    COUNT(*) as TOTAL_RUNS,
    SUM(CASE WHEN d.SYNC_STATUS = 'SUCCESS' THEN 1 ELSE 0 END) as SUCCESS,
    SUM(CASE WHEN d.SYNC_STATUS = 'FAILED' THEN 1 ELSE 0 END) as FAILED,
    SUM(d.FETCHED_RECORDS) as TOTAL_FETCHED,
    SUM(d.SYNCED_RECORDS) as TOTAL_SYNCED,
    SUM(d.ERROR_RECORDS) as TOTAL_ERRORS
FROM RR_SYNC_JOBS_DETAILS d
JOIN RR_SYNC_JOBS_HEADER h ON d.SYNC_JOB_ID = h.SYNC_JOB_ID
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE d.START_DATE >= TRUNC(SYSDATE) - 7
GROUP BY TO_CHAR(d.START_DATE, 'YYYY-MM-DD'), m.MODULE
ORDER BY TO_CHAR(d.START_DATE, 'YYYY-MM-DD') DESC, m.MODULE;

-- View currently running jobs
SELECT
    d.EXECUTION_ID,
    h.JOB_NAME,
    m.MODULE,
    TO_CHAR(d.START_TIME, 'YYYY-MM-DD HH24:MI:SS') as STARTED_AT,
    ROUND((SYSDATE - d.START_DATE) * 24 * 60, 1) as RUNNING_MINUTES,
    d.TRIGGERED_BY,
    d.TRIGGERED_BY_USER
FROM RR_SYNC_JOBS_DETAILS d
JOIN RR_SYNC_JOBS_HEADER h ON d.SYNC_JOB_ID = h.SYNC_JOB_ID
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE d.SYNC_STATUS = 'RUNNING'
ORDER BY d.START_TIME;

-- View failed jobs in last 24 hours
SELECT
    h.JOB_NAME,
    m.MODULE,
    TO_CHAR(d.START_TIME, 'YYYY-MM-DD HH24:MI:SS') as FAILED_AT,
    d.ERROR_MESSAGE,
    d.RETRY_COUNT,
    d.TRIGGERED_BY
FROM RR_SYNC_JOBS_DETAILS d
JOIN RR_SYNC_JOBS_HEADER h ON d.SYNC_JOB_ID = h.SYNC_JOB_ID
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE d.SYNC_STATUS = 'FAILED'
    AND d.START_DATE >= TRUNC(SYSDATE)
ORDER BY d.START_TIME DESC;

/*
=====================================================
TROUBLESHOOTING
=====================================================

ISSUE 1: Network Access Denied
-------------------------------
Error: ORA-24247: network access denied by access control list (ACL)

Solution: Grant network access (see STEP 5 above)

ISSUE 2: Job Stuck in RUNNING Status
-------------------------------------
Problem: Execution log shows RUNNING but job crashed

Solution: Manually update status:
*/

UPDATE RR_SYNC_JOBS_DETAILS
SET SYNC_STATUS = 'FAILED',
    END_DATE = SYSDATE,
    END_TIME = SYSTIMESTAMP,
    ERROR_MESSAGE = 'Job stuck - manually terminated'
WHERE EXECUTION_ID = :your_execution_id;
COMMIT;

/*
ISSUE 3: Authentication Failure
--------------------------------
Error: HTTP 401 Unauthorized

Solution:
1. Verify Oracle Fusion credentials
2. Check if password needs to be re-encrypted
3. Ensure user has proper roles in Oracle Fusion

ISSUE 4: No Jobs Executing
---------------------------
Problem: Scheduler is enabled but no jobs run

Solution: Check if jobs are due:
*/

SELECT * FROM RR_SYNC_JOBS_HEADER
WHERE SCHEDULE_STATUS = 'ACTIVE'
    AND IS_ACTIVE = 'Y'
    AND NEXT_RUN_DATE IS NOT NULL;

-- Manually calculate next run dates:
BEGIN
    FOR job IN (SELECT SYNC_JOB_ID FROM RR_SYNC_JOBS_HEADER WHERE SCHEDULE_STATUS = 'ACTIVE') LOOP
        RR_SYNC_JOBS_PKG.CALCULATE_NEXT_RUN(job.SYNC_JOB_ID);
    END LOOP;
END;
/

/*
=====================================================
CLEANUP AND MAINTENANCE
=====================================================
*/

-- Archive old execution logs (older than 90 days)
CREATE TABLE RR_SYNC_JOBS_DETAILS_ARCHIVE AS
SELECT * FROM RR_SYNC_JOBS_DETAILS WHERE 1=0;

INSERT INTO RR_SYNC_JOBS_DETAILS_ARCHIVE
SELECT * FROM RR_SYNC_JOBS_DETAILS
WHERE START_DATE < TRUNC(SYSDATE) - 90;

DELETE FROM RR_SYNC_JOBS_DETAILS
WHERE START_DATE < TRUNC(SYSDATE) - 90;

COMMIT;

-- Vacuum/analyze tables for performance
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(USER, 'RR_SYNC_JOBS_MASTER');
    DBMS_STATS.GATHER_TABLE_STATS(USER, 'RR_SYNC_JOBS_HEADER');
    DBMS_STATS.GATHER_TABLE_STATS(USER, 'RR_SYNC_JOBS_DETAILS');
END;
/

/*
=====================================================
UNINSTALL (if needed)
=====================================================
*/

-- Drop all sync jobs objects
DROP PACKAGE RR_SYNC_JOBS_PKG;
DROP TABLE RR_SYNC_JOBS_DETAILS CASCADE CONSTRAINTS;
DROP TABLE RR_SYNC_JOBS_HEADER CASCADE CONSTRAINTS;
DROP TABLE RR_SYNC_JOBS_MASTER CASCADE CONSTRAINTS;
DROP SEQUENCE RR_SYNC_JOBS_DETAILS_SEQ;
DROP SEQUENCE RR_SYNC_JOBS_HEADER_SEQ;
DROP SEQUENCE RR_SYNC_JOBS_MASTER_SEQ;

-- Drop ORDS handlers
BEGIN
    ORDS.DELETE_MODULE(p_module_name => 'rr');
    COMMIT;
END;
/

PROMPT
PROMPT =====================================================
PROMPT RR SYNC JOBS - SETUP COMPLETE!
PROMPT =====================================================
PROMPT
PROMPT Database Objects:
PROMPT - 3 Tables (Master, Header, Details)
PROMPT - 3 Sequences
PROMPT - 1 Package (RR_SYNC_JOBS_PKG)
PROMPT - 15+ REST Endpoints
PROMPT
PROMPT Next Steps:
PROMPT 1. Create APEX page using 06_rr_sync_jobs_apex_page.sql
PROMPT 2. Configure network access for Oracle Fusion
PROMPT 3. Create your first sync job
PROMPT 4. Test execution
PROMPT 5. Enable scheduler
PROMPT
PROMPT Documentation:
PROMPT - All endpoints documented in individual handler files
PROMPT - Testing examples in this guide
PROMPT - Monitoring queries provided above
PROMPT
PROMPT Support:
PROMPT - Review error logs in RR_SYNC_JOBS_DETAILS
PROMPT - Check scheduler job status
PROMPT - Use troubleshooting section above
PROMPT =====================================================

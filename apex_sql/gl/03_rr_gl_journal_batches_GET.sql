-- ============================================================================
-- RR_GL_JOURNAL_BATCHES GET HANDLER
-- Description: Retrieve synced journal batches from local database
-- Method: GET
-- Endpoints:
--   - /rr/gl/journalbatches (get all with pagination)
--   - /rr/gl/journalbatches/:id (get by batch sync id)
-- Created: 2025-11-10
-- ============================================================================

-- ============================================================================
-- GET ALL JOURNAL BATCHES (with pagination and filters)
-- ============================================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr.gl',
        p_pattern        => 'journalbatches',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query,
        p_source         => q'[
SELECT
    BATCH_SYNC_ID as "batchSyncId",
    JE_BATCH_ID as "jeBatchId",
    ACCOUNTED_PERIOD_TYPE as "accountedPeriodType",
    DEFAULT_PERIOD_NAME as "defaultPeriodName",
    BATCH_NAME as "batchName",
    STATUS as "status",
    CONTROL_TOTAL as "controlTotal",
    BATCH_DESCRIPTION as "batchDescription",
    ERROR_MESSAGE as "errorMessage",
    TO_CHAR(POSTED_DATE, 'YYYY-MM-DD') as "postedDate",
    POSTING_RUN_ID as "postingRunId",
    REQUEST_ID as "requestId",
    RUNNING_TOTAL_ACCT_CR as "runningTotalAccountedCr",
    RUNNING_TOTAL_ACCT_DR as "runningTotalAccountedDr",
    RUNNING_TOTAL_CR as "runningTotalCr",
    RUNNING_TOTAL_DR as "runningTotalDr",
    ORACLE_CREATED_BY as "oracleCreatedBy",
    TO_CHAR(ORACLE_CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "oracleCreationDate",
    TO_CHAR(ORACLE_LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "oracleLastUpdateDate",
    ORACLE_LAST_UPDATED_BY as "oracleLastUpdatedBy",
    ACTUAL_FLAG_MEANING as "actualFlagMeaning",
    APPROVAL_STATUS_MEANING as "approvalStatusMeaning",
    APPROVER_EMPLOYEE_NAME as "approverEmployeeName",
    FUNDS_STATUS_MEANING as "fundsStatusMeaning",
    PARENT_JE_BATCH_NAME as "parentJeBatchName",
    CHART_OF_ACCOUNTS_NAME as "chartOfAccountsName",
    STATUS_MEANING as "statusMeaning",
    COMPLETION_STATUS_MEANING as "completionStatusMeaning",
    USER_PERIOD_SET_NAME as "userPeriodSetName",
    USER_JE_SOURCE_NAME as "userJeSourceName",
    TO_CHAR(REVERSAL_DATE, 'YYYY-MM-DD') as "reversalDate",
    REVERSAL_PERIOD as "reversalPeriod",
    REVERSAL_FLAG as "reversalFlag",
    REVERSAL_METHOD_MEANING as "reversalMethodMeaning",
    SYNC_STATUS as "syncStatus",
    TO_CHAR(SYNC_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "syncDate",
    SYNC_ERROR_MESSAGE as "syncErrorMessage",
    TO_CHAR(LAST_SYNC_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "lastSyncDate",
    SYNC_COUNT as "syncCount",
    CREATED_BY as "createdBy",
    TO_CHAR(CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "creationDate",
    LAST_UPDATED_BY as "lastUpdatedBy",
    TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "lastUpdateDate"
FROM RR_GL_JOURNAL_BATCHES
WHERE 1=1
    AND (:period_name IS NULL OR DEFAULT_PERIOD_NAME = :period_name)
    AND (:status IS NULL OR STATUS = :status)
    AND (:sync_status IS NULL OR SYNC_STATUS = :sync_status)
    AND (:je_batch_id IS NULL OR JE_BATCH_ID = :je_batch_id)
    AND (:search IS NULL OR
         UPPER(BATCH_NAME) LIKE '%' || UPPER(:search) || '%' OR
         UPPER(BATCH_DESCRIPTION) LIKE '%' || UPPER(:search) || '%')
ORDER BY POSTED_DATE DESC, BATCH_SYNC_ID DESC
OFFSET :offset ROWS
FETCH NEXT :limit ROWS ONLY
]',
        p_items_per_page => 0,
        p_comments       => 'GET all journal batches with filters and pagination'
    );

    -- Define query parameters
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'rr.gl',
        p_pattern            => 'journalbatches',
        p_method             => 'GET',
        p_name               => 'limit',
        p_bind_variable_name => 'limit',
        p_source_type        => 'QUERY',
        p_param_type         => 'INT',
        p_access_method      => 'IN',
        p_comments           => 'Number of records to return'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'rr.gl',
        p_pattern            => 'journalbatches',
        p_method             => 'GET',
        p_name               => 'offset',
        p_bind_variable_name => 'offset',
        p_source_type        => 'QUERY',
        p_param_type         => 'INT',
        p_access_method      => 'IN',
        p_comments           => 'Number of records to skip'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'rr.gl',
        p_pattern            => 'journalbatches',
        p_method             => 'GET',
        p_name               => 'period_name',
        p_bind_variable_name => 'period_name',
        p_source_type        => 'QUERY',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Filter by period name (e.g., May-23)'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'rr.gl',
        p_pattern            => 'journalbatches',
        p_method             => 'GET',
        p_name               => 'status',
        p_bind_variable_name => 'status',
        p_source_type        => 'QUERY',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Filter by status (e.g., P for Posted)'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'rr.gl',
        p_pattern            => 'journalbatches',
        p_method             => 'GET',
        p_name               => 'sync_status',
        p_bind_variable_name => 'sync_status',
        p_source_type        => 'QUERY',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Filter by sync status (SYNCED, PENDING, ERROR)'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'rr.gl',
        p_pattern            => 'journalbatches',
        p_method             => 'GET',
        p_name               => 'je_batch_id',
        p_bind_variable_name => 'je_batch_id',
        p_source_type        => 'QUERY',
        p_param_type         => 'INT',
        p_access_method      => 'IN',
        p_comments           => 'Filter by Oracle JE Batch ID'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'rr.gl',
        p_pattern            => 'journalbatches',
        p_method             => 'GET',
        p_name               => 'search',
        p_bind_variable_name => 'search',
        p_source_type        => 'QUERY',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Search in batch name and description'
    );

    COMMIT;
END;
/

-- ============================================================================
-- GET SINGLE JOURNAL BATCH BY ID
-- ============================================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr.gl',
        p_pattern        => 'journalbatches/:id',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Get single journal batch by sync ID'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr.gl',
        p_pattern        => 'journalbatches/:id',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query_one_row,
        p_source         => q'[
SELECT
    BATCH_SYNC_ID as "batchSyncId",
    JE_BATCH_ID as "jeBatchId",
    ACCOUNTED_PERIOD_TYPE as "accountedPeriodType",
    DEFAULT_PERIOD_NAME as "defaultPeriodName",
    BATCH_NAME as "batchName",
    STATUS as "status",
    CONTROL_TOTAL as "controlTotal",
    BATCH_DESCRIPTION as "batchDescription",
    ERROR_MESSAGE as "errorMessage",
    TO_CHAR(POSTED_DATE, 'YYYY-MM-DD') as "postedDate",
    POSTING_RUN_ID as "postingRunId",
    REQUEST_ID as "requestId",
    RUNNING_TOTAL_ACCT_CR as "runningTotalAccountedCr",
    RUNNING_TOTAL_ACCT_DR as "runningTotalAccountedDr",
    RUNNING_TOTAL_CR as "runningTotalCr",
    RUNNING_TOTAL_DR as "runningTotalDr",
    ORACLE_CREATED_BY as "oracleCreatedBy",
    TO_CHAR(ORACLE_CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "oracleCreationDate",
    TO_CHAR(ORACLE_LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "oracleLastUpdateDate",
    ORACLE_LAST_UPDATED_BY as "oracleLastUpdatedBy",
    ACTUAL_FLAG_MEANING as "actualFlagMeaning",
    APPROVAL_STATUS_MEANING as "approvalStatusMeaning",
    APPROVER_EMPLOYEE_NAME as "approverEmployeeName",
    FUNDS_STATUS_MEANING as "fundsStatusMeaning",
    PARENT_JE_BATCH_NAME as "parentJeBatchName",
    CHART_OF_ACCOUNTS_NAME as "chartOfAccountsName",
    STATUS_MEANING as "statusMeaning",
    COMPLETION_STATUS_MEANING as "completionStatusMeaning",
    USER_PERIOD_SET_NAME as "userPeriodSetName",
    USER_JE_SOURCE_NAME as "userJeSourceName",
    TO_CHAR(REVERSAL_DATE, 'YYYY-MM-DD') as "reversalDate",
    REVERSAL_PERIOD as "reversalPeriod",
    REVERSAL_FLAG as "reversalFlag",
    REVERSAL_METHOD_MEANING as "reversalMethodMeaning",
    SYNC_STATUS as "syncStatus",
    TO_CHAR(SYNC_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "syncDate",
    SYNC_ERROR_MESSAGE as "syncErrorMessage",
    TO_CHAR(LAST_SYNC_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "lastSyncDate",
    SYNC_COUNT as "syncCount",
    CREATED_BY as "createdBy",
    TO_CHAR(CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "creationDate",
    LAST_UPDATED_BY as "lastUpdatedBy",
    TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as "lastUpdateDate"
FROM RR_GL_JOURNAL_BATCHES
WHERE BATCH_SYNC_ID = :id
]',
        p_comments       => 'GET single journal batch by sync ID'
    );

    COMMIT;
END;
/

PROMPT ✅ GET /rr/gl/journalbatches endpoint registered successfully!
PROMPT ✅ GET /rr/gl/journalbatches/:id endpoint registered successfully!
PROMPT ✅ All query parameters defined successfully!

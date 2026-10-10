-- ============================================================================
-- RR_GL_JOURNAL_BATCHES POST HANDLER
-- Description: Sync journal batches from Oracle Fusion Cloud to local DB
-- Method: POST
-- Endpoint: /rr/gl/journalbatches
-- Created: 2025-11-10
-- ============================================================================

CREATE OR REPLACE PROCEDURE RR_GL_SYNC_JOURNAL_BATCH (
    p_je_batch_id               IN NUMBER,
    p_accounted_period_type     IN VARCHAR2 DEFAULT NULL,
    p_default_period_name       IN VARCHAR2 DEFAULT NULL,
    p_batch_name                IN VARCHAR2 DEFAULT NULL,
    p_status                    IN VARCHAR2 DEFAULT NULL,
    p_control_total             IN NUMBER DEFAULT NULL,
    p_batch_description         IN VARCHAR2 DEFAULT NULL,
    p_error_message             IN VARCHAR2 DEFAULT NULL,
    p_posted_date               IN VARCHAR2 DEFAULT NULL,
    p_posting_run_id            IN NUMBER DEFAULT NULL,
    p_request_id                IN NUMBER DEFAULT NULL,
    p_running_total_acct_cr     IN NUMBER DEFAULT NULL,
    p_running_total_acct_dr     IN NUMBER DEFAULT NULL,
    p_running_total_cr          IN NUMBER DEFAULT NULL,
    p_running_total_dr          IN NUMBER DEFAULT NULL,
    p_oracle_created_by         IN VARCHAR2 DEFAULT NULL,
    p_oracle_creation_date      IN VARCHAR2 DEFAULT NULL,
    p_oracle_last_update_date   IN VARCHAR2 DEFAULT NULL,
    p_oracle_last_updated_by    IN VARCHAR2 DEFAULT NULL,
    p_actual_flag_meaning       IN VARCHAR2 DEFAULT NULL,
    p_approval_status_meaning   IN VARCHAR2 DEFAULT NULL,
    p_approver_employee_name    IN VARCHAR2 DEFAULT NULL,
    p_funds_status_meaning      IN VARCHAR2 DEFAULT NULL,
    p_parent_je_batch_name      IN VARCHAR2 DEFAULT NULL,
    p_chart_of_accounts_name    IN VARCHAR2 DEFAULT NULL,
    p_status_meaning            IN VARCHAR2 DEFAULT NULL,
    p_completion_status_meaning IN VARCHAR2 DEFAULT NULL,
    p_user_period_set_name      IN VARCHAR2 DEFAULT NULL,
    p_user_je_source_name       IN VARCHAR2 DEFAULT NULL,
    p_reversal_date             IN VARCHAR2 DEFAULT NULL,
    p_reversal_period           IN VARCHAR2 DEFAULT NULL,
    p_reversal_flag             IN VARCHAR2 DEFAULT NULL,
    p_reversal_method_meaning   IN VARCHAR2 DEFAULT NULL,
    p_result                    OUT VARCHAR2,
    p_message                   OUT VARCHAR2
) AS
    v_batch_sync_id NUMBER;
    v_exists        NUMBER;
    v_posted_date   DATE;
    v_reversal_date DATE;
    v_oracle_creation_date      TIMESTAMP;
    v_oracle_last_update_date   TIMESTAMP;
BEGIN
    -- Convert date strings to DATE/TIMESTAMP
    BEGIN
        v_posted_date := TO_DATE(p_posted_date, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_posted_date := NULL;
    END;

    BEGIN
        v_reversal_date := TO_DATE(p_reversal_date, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_reversal_date := NULL;
    END;

    BEGIN
        v_oracle_creation_date := TO_TIMESTAMP(p_oracle_creation_date, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"');
    EXCEPTION
        WHEN OTHERS THEN
            v_oracle_creation_date := NULL;
    END;

    BEGIN
        v_oracle_last_update_date := TO_TIMESTAMP(p_oracle_last_update_date, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"');
    EXCEPTION
        WHEN OTHERS THEN
            v_oracle_last_update_date := NULL;
    END;

    -- Check if record exists
    SELECT COUNT(*)
    INTO v_exists
    FROM RR_GL_JOURNAL_BATCHES
    WHERE JE_BATCH_ID = p_je_batch_id;

    IF v_exists > 0 THEN
        -- Update existing record
        UPDATE RR_GL_JOURNAL_BATCHES
        SET
            ACCOUNTED_PERIOD_TYPE = p_accounted_period_type,
            DEFAULT_PERIOD_NAME = p_default_period_name,
            BATCH_NAME = p_batch_name,
            STATUS = p_status,
            CONTROL_TOTAL = p_control_total,
            BATCH_DESCRIPTION = p_batch_description,
            ERROR_MESSAGE = p_error_message,
            POSTED_DATE = v_posted_date,
            POSTING_RUN_ID = p_posting_run_id,
            REQUEST_ID = p_request_id,
            RUNNING_TOTAL_ACCT_CR = p_running_total_acct_cr,
            RUNNING_TOTAL_ACCT_DR = p_running_total_acct_dr,
            RUNNING_TOTAL_CR = p_running_total_cr,
            RUNNING_TOTAL_DR = p_running_total_dr,
            ORACLE_CREATED_BY = p_oracle_created_by,
            ORACLE_CREATION_DATE = v_oracle_creation_date,
            ORACLE_LAST_UPDATE_DATE = v_oracle_last_update_date,
            ORACLE_LAST_UPDATED_BY = p_oracle_last_updated_by,
            ACTUAL_FLAG_MEANING = p_actual_flag_meaning,
            APPROVAL_STATUS_MEANING = p_approval_status_meaning,
            APPROVER_EMPLOYEE_NAME = p_approver_employee_name,
            FUNDS_STATUS_MEANING = p_funds_status_meaning,
            PARENT_JE_BATCH_NAME = p_parent_je_batch_name,
            CHART_OF_ACCOUNTS_NAME = p_chart_of_accounts_name,
            STATUS_MEANING = p_status_meaning,
            COMPLETION_STATUS_MEANING = p_completion_status_meaning,
            USER_PERIOD_SET_NAME = p_user_period_set_name,
            USER_JE_SOURCE_NAME = p_user_je_source_name,
            REVERSAL_DATE = v_reversal_date,
            REVERSAL_PERIOD = p_reversal_period,
            REVERSAL_FLAG = p_reversal_flag,
            REVERSAL_METHOD_MEANING = p_reversal_method_meaning,
            LAST_SYNC_DATE = SYSTIMESTAMP,
            SYNC_COUNT = SYNC_COUNT + 1,
            SYNC_STATUS = 'SYNCED',
            LAST_UPDATED_BY = 'SYNC_SERVICE',
            LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE JE_BATCH_ID = p_je_batch_id
        RETURNING BATCH_SYNC_ID INTO v_batch_sync_id;

        p_result := 'SUCCESS';
        p_message := 'Journal batch updated successfully. Sync ID: ' || v_batch_sync_id;

    ELSE
        -- Insert new record
        INSERT INTO RR_GL_JOURNAL_BATCHES (
            BATCH_SYNC_ID,
            JE_BATCH_ID,
            ACCOUNTED_PERIOD_TYPE,
            DEFAULT_PERIOD_NAME,
            BATCH_NAME,
            STATUS,
            CONTROL_TOTAL,
            BATCH_DESCRIPTION,
            ERROR_MESSAGE,
            POSTED_DATE,
            POSTING_RUN_ID,
            REQUEST_ID,
            RUNNING_TOTAL_ACCT_CR,
            RUNNING_TOTAL_ACCT_DR,
            RUNNING_TOTAL_CR,
            RUNNING_TOTAL_DR,
            ORACLE_CREATED_BY,
            ORACLE_CREATION_DATE,
            ORACLE_LAST_UPDATE_DATE,
            ORACLE_LAST_UPDATED_BY,
            ACTUAL_FLAG_MEANING,
            APPROVAL_STATUS_MEANING,
            APPROVER_EMPLOYEE_NAME,
            FUNDS_STATUS_MEANING,
            PARENT_JE_BATCH_NAME,
            CHART_OF_ACCOUNTS_NAME,
            STATUS_MEANING,
            COMPLETION_STATUS_MEANING,
            USER_PERIOD_SET_NAME,
            USER_JE_SOURCE_NAME,
            REVERSAL_DATE,
            REVERSAL_PERIOD,
            REVERSAL_FLAG,
            REVERSAL_METHOD_MEANING,
            SYNC_STATUS,
            SYNC_DATE,
            LAST_SYNC_DATE,
            CREATED_BY,
            CREATION_DATE
        ) VALUES (
            RR_GL_JOURNAL_BATCHES_SEQ.NEXTVAL,
            p_je_batch_id,
            p_accounted_period_type,
            p_default_period_name,
            p_batch_name,
            p_status,
            p_control_total,
            p_batch_description,
            p_error_message,
            v_posted_date,
            p_posting_run_id,
            p_request_id,
            p_running_total_acct_cr,
            p_running_total_acct_dr,
            p_running_total_cr,
            p_running_total_dr,
            p_oracle_created_by,
            v_oracle_creation_date,
            v_oracle_last_update_date,
            p_oracle_last_updated_by,
            p_actual_flag_meaning,
            p_approval_status_meaning,
            p_approver_employee_name,
            p_funds_status_meaning,
            p_parent_je_batch_name,
            p_chart_of_accounts_name,
            p_status_meaning,
            p_completion_status_meaning,
            p_user_period_set_name,
            p_user_je_source_name,
            v_reversal_date,
            p_reversal_period,
            p_reversal_flag,
            p_reversal_method_meaning,
            'SYNCED',
            SYSTIMESTAMP,
            SYSTIMESTAMP,
            'SYNC_SERVICE',
            SYSTIMESTAMP
        ) RETURNING BATCH_SYNC_ID INTO v_batch_sync_id;

        p_result := 'SUCCESS';
        p_message := 'Journal batch created successfully. Sync ID: ' || v_batch_sync_id;
    END IF;

    COMMIT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR';
        p_message := 'Error syncing journal batch: ' || SQLERRM;
        DBMS_OUTPUT.PUT_LINE('Error in RR_GL_SYNC_JOURNAL_BATCH: ' || SQLERRM);
END RR_GL_SYNC_JOURNAL_BATCH;
/

-- ============================================================================
-- APEX REST HANDLER - POST
-- ============================================================================

BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'rr.gl',
        p_base_path      => '/rr/gl/',
        p_items_per_page => 0
    );

    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr.gl',
        p_pattern        => 'journalbatches',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Sync journal batches from Oracle Fusion Cloud GL'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr.gl',
        p_pattern        => 'journalbatches',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
DECLARE
    v_result    VARCHAR2(100);
    v_message   VARCHAR2(4000);
    v_body      CLOB;
BEGIN
    -- Get request body
    v_body := :body_text;

    -- Call sync procedure
    RR_GL_SYNC_JOURNAL_BATCH(
        p_je_batch_id               => JSON_VALUE(v_body, '$.JeBatchId'),
        p_accounted_period_type     => JSON_VALUE(v_body, '$.AccountedPeriodType'),
        p_default_period_name       => JSON_VALUE(v_body, '$.DefaultPeriodName'),
        p_batch_name                => JSON_VALUE(v_body, '$.BatchName'),
        p_status                    => JSON_VALUE(v_body, '$.Status'),
        p_control_total             => JSON_VALUE(v_body, '$.ControlTotal'),
        p_batch_description         => JSON_VALUE(v_body, '$.BatchDescription'),
        p_error_message             => JSON_VALUE(v_body, '$.ErrorMessage'),
        p_posted_date               => JSON_VALUE(v_body, '$.PostedDate'),
        p_posting_run_id            => JSON_VALUE(v_body, '$.PostingRunId'),
        p_request_id                => JSON_VALUE(v_body, '$.RequestId'),
        p_running_total_acct_cr     => JSON_VALUE(v_body, '$.RunningTotalAccountedCr'),
        p_running_total_acct_dr     => JSON_VALUE(v_body, '$.RunningTotalAccountedDr'),
        p_running_total_cr          => JSON_VALUE(v_body, '$.RunningTotalCr'),
        p_running_total_dr          => JSON_VALUE(v_body, '$.RunningTotalDr'),
        p_oracle_created_by         => JSON_VALUE(v_body, '$.CreatedBy'),
        p_oracle_creation_date      => JSON_VALUE(v_body, '$.CreationDate'),
        p_oracle_last_update_date   => JSON_VALUE(v_body, '$.LastUpdateDate'),
        p_oracle_last_updated_by    => JSON_VALUE(v_body, '$.LastUpdatedBy'),
        p_actual_flag_meaning       => JSON_VALUE(v_body, '$.ActualFlagMeaning'),
        p_approval_status_meaning   => JSON_VALUE(v_body, '$.ApprovalStatusMeaning'),
        p_approver_employee_name    => JSON_VALUE(v_body, '$.ApproverEmployeeName'),
        p_funds_status_meaning      => JSON_VALUE(v_body, '$.FundsStatusMeaning'),
        p_parent_je_batch_name      => JSON_VALUE(v_body, '$.ParentJeBatchName'),
        p_chart_of_accounts_name    => JSON_VALUE(v_body, '$.ChartOfAccountsName'),
        p_status_meaning            => JSON_VALUE(v_body, '$.StatusMeaning'),
        p_completion_status_meaning => JSON_VALUE(v_body, '$.CompletionStatusMeaning'),
        p_user_period_set_name      => JSON_VALUE(v_body, '$.UserPeriodSetName'),
        p_user_je_source_name       => JSON_VALUE(v_body, '$.UserJeSourceName'),
        p_reversal_date             => JSON_VALUE(v_body, '$.ReversalDate'),
        p_reversal_period           => JSON_VALUE(v_body, '$.ReversalPeriod'),
        p_reversal_flag             => JSON_VALUE(v_body, '$.ReversalFlag'),
        p_reversal_method_meaning   => JSON_VALUE(v_body, '$.ReversalMethodMeaning'),
        p_result                    => v_result,
        p_message                   => v_message
    );

    -- Return JSON response
    HTP.P('{');
    HTP.P('"status": "' || v_result || '",');
    HTP.P('"message": "' || REPLACE(v_message, '"', '\"') || '"');
    HTP.P('}');

    :status := 200;

EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{');
        HTP.P('"status": "ERROR",');
        HTP.P('"message": "' || REPLACE(SQLERRM, '"', '\"') || '"');
        HTP.P('}');
        :status := 500;
END;
]',
        p_comments       => 'POST handler to sync journal batch from Oracle Fusion'
    );

    COMMIT;
END;
/

PROMPT ✅ RR_GL_SYNC_JOURNAL_BATCH procedure created successfully!
PROMPT ✅ POST /rr/gl/journalbatches endpoint registered successfully!

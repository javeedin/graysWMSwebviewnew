-- ============================================================================
-- RR_GL_PKG - GL Journal Batch Operations Package
-- Description: Helper functions and procedures for GL sync operations
-- Created: 2025-11-10
-- ============================================================================

CREATE OR REPLACE PACKAGE RR_GL_PKG AS
    -- Bulk sync from JSON array
    PROCEDURE BULK_SYNC_BATCHES(
        p_json_array    IN CLOB,
        p_sync_count    OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_message       OUT VARCHAR2
    );

    -- Get sync statistics
    FUNCTION GET_SYNC_STATS RETURN CLOB;

    -- Get batches by period
    FUNCTION GET_BATCHES_BY_PERIOD(
        p_period_name IN VARCHAR2
    ) RETURN CLOB;

    -- Mark batch as error
    PROCEDURE MARK_BATCH_ERROR(
        p_batch_sync_id IN NUMBER,
        p_error_message IN VARCHAR2
    );

    -- Get sync summary
    FUNCTION GET_SYNC_SUMMARY(
        p_from_date IN DATE DEFAULT NULL,
        p_to_date   IN DATE DEFAULT NULL
    ) RETURN CLOB;

    -- Delete old synced batches (cleanup)
    PROCEDURE CLEANUP_OLD_BATCHES(
        p_days_old  IN NUMBER DEFAULT 90,
        p_deleted   OUT NUMBER
    );

END RR_GL_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_GL_PKG AS

    -- ========================================================================
    -- BULK_SYNC_BATCHES
    -- Description: Sync multiple journal batches from JSON array
    -- ========================================================================
    PROCEDURE BULK_SYNC_BATCHES(
        p_json_array    IN CLOB,
        p_sync_count    OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_message       OUT VARCHAR2
    ) AS
        v_result        VARCHAR2(100);
        v_msg           VARCHAR2(4000);
        v_sync_count    NUMBER := 0;
        v_error_count   NUMBER := 0;
    BEGIN
        -- Loop through JSON array
        FOR batch IN (
            SELECT
                JSON_VALUE(value, '$.JeBatchId') as je_batch_id,
                JSON_VALUE(value, '$.AccountedPeriodType') as accounted_period_type,
                JSON_VALUE(value, '$.DefaultPeriodName') as default_period_name,
                JSON_VALUE(value, '$.BatchName') as batch_name,
                JSON_VALUE(value, '$.Status') as status,
                JSON_VALUE(value, '$.ControlTotal') as control_total,
                JSON_VALUE(value, '$.BatchDescription') as batch_description,
                JSON_VALUE(value, '$.ErrorMessage') as error_message,
                JSON_VALUE(value, '$.PostedDate') as posted_date,
                JSON_VALUE(value, '$.PostingRunId') as posting_run_id,
                JSON_VALUE(value, '$.RequestId') as request_id,
                JSON_VALUE(value, '$.RunningTotalAccountedCr') as running_total_acct_cr,
                JSON_VALUE(value, '$.RunningTotalAccountedDr') as running_total_acct_dr,
                JSON_VALUE(value, '$.RunningTotalCr') as running_total_cr,
                JSON_VALUE(value, '$.RunningTotalDr') as running_total_dr,
                JSON_VALUE(value, '$.CreatedBy') as oracle_created_by,
                JSON_VALUE(value, '$.CreationDate') as oracle_creation_date,
                JSON_VALUE(value, '$.LastUpdateDate') as oracle_last_update_date,
                JSON_VALUE(value, '$.LastUpdatedBy') as oracle_last_updated_by,
                JSON_VALUE(value, '$.ActualFlagMeaning') as actual_flag_meaning,
                JSON_VALUE(value, '$.ApprovalStatusMeaning') as approval_status_meaning,
                JSON_VALUE(value, '$.ApproverEmployeeName') as approver_employee_name,
                JSON_VALUE(value, '$.FundsStatusMeaning') as funds_status_meaning,
                JSON_VALUE(value, '$.ParentJeBatchName') as parent_je_batch_name,
                JSON_VALUE(value, '$.ChartOfAccountsName') as chart_of_accounts_name,
                JSON_VALUE(value, '$.StatusMeaning') as status_meaning,
                JSON_VALUE(value, '$.CompletionStatusMeaning') as completion_status_meaning,
                JSON_VALUE(value, '$.UserPeriodSetName') as user_period_set_name,
                JSON_VALUE(value, '$.UserJeSourceName') as user_je_source_name,
                JSON_VALUE(value, '$.ReversalDate') as reversal_date,
                JSON_VALUE(value, '$.ReversalPeriod') as reversal_period,
                JSON_VALUE(value, '$.ReversalFlag') as reversal_flag,
                JSON_VALUE(value, '$.ReversalMethodMeaning') as reversal_method_meaning
            FROM JSON_TABLE(p_json_array, '$[*]' COLUMNS (value CLOB PATH '$'))
        )
        LOOP
            BEGIN
                RR_GL_SYNC_JOURNAL_BATCH(
                    p_je_batch_id               => batch.je_batch_id,
                    p_accounted_period_type     => batch.accounted_period_type,
                    p_default_period_name       => batch.default_period_name,
                    p_batch_name                => batch.batch_name,
                    p_status                    => batch.status,
                    p_control_total             => batch.control_total,
                    p_batch_description         => batch.batch_description,
                    p_error_message             => batch.error_message,
                    p_posted_date               => batch.posted_date,
                    p_posting_run_id            => batch.posting_run_id,
                    p_request_id                => batch.request_id,
                    p_running_total_acct_cr     => batch.running_total_acct_cr,
                    p_running_total_acct_dr     => batch.running_total_acct_dr,
                    p_running_total_cr          => batch.running_total_cr,
                    p_running_total_dr          => batch.running_total_dr,
                    p_oracle_created_by         => batch.oracle_created_by,
                    p_oracle_creation_date      => batch.oracle_creation_date,
                    p_oracle_last_update_date   => batch.oracle_last_update_date,
                    p_oracle_last_updated_by    => batch.oracle_last_updated_by,
                    p_actual_flag_meaning       => batch.actual_flag_meaning,
                    p_approval_status_meaning   => batch.approval_status_meaning,
                    p_approver_employee_name    => batch.approver_employee_name,
                    p_funds_status_meaning      => batch.funds_status_meaning,
                    p_parent_je_batch_name      => batch.parent_je_batch_name,
                    p_chart_of_accounts_name    => batch.chart_of_accounts_name,
                    p_status_meaning            => batch.status_meaning,
                    p_completion_status_meaning => batch.completion_status_meaning,
                    p_user_period_set_name      => batch.user_period_set_name,
                    p_user_je_source_name       => batch.user_je_source_name,
                    p_reversal_date             => batch.reversal_date,
                    p_reversal_period           => batch.reversal_period,
                    p_reversal_flag             => batch.reversal_flag,
                    p_reversal_method_meaning   => batch.reversal_method_meaning,
                    p_result                    => v_result,
                    p_message                   => v_msg
                );

                IF v_result = 'SUCCESS' THEN
                    v_sync_count := v_sync_count + 1;
                ELSE
                    v_error_count := v_error_count + 1;
                END IF;

            EXCEPTION
                WHEN OTHERS THEN
                    v_error_count := v_error_count + 1;
                    DBMS_OUTPUT.PUT_LINE('Error syncing batch ' || batch.je_batch_id || ': ' || SQLERRM);
            END;
        END LOOP;

        p_sync_count := v_sync_count;
        p_error_count := v_error_count;
        p_message := 'Bulk sync completed. Synced: ' || v_sync_count || ', Errors: ' || v_error_count;

    EXCEPTION
        WHEN OTHERS THEN
            p_sync_count := v_sync_count;
            p_error_count := v_error_count;
            p_message := 'Error in bulk sync: ' || SQLERRM;
    END BULK_SYNC_BATCHES;

    -- ========================================================================
    -- GET_SYNC_STATS
    -- Description: Get sync statistics as JSON
    -- ========================================================================
    FUNCTION GET_SYNC_STATS RETURN CLOB AS
        v_json CLOB;
    BEGIN
        SELECT JSON_OBJECT(
            'totalBatches' VALUE COUNT(*),
            'syncedBatches' VALUE SUM(CASE WHEN SYNC_STATUS = 'SYNCED' THEN 1 ELSE 0 END),
            'errorBatches' VALUE SUM(CASE WHEN SYNC_STATUS = 'ERROR' THEN 1 ELSE 0 END),
            'pendingBatches' VALUE SUM(CASE WHEN SYNC_STATUS = 'PENDING' THEN 1 ELSE 0 END),
            'lastSyncDate' VALUE TO_CHAR(MAX(SYNC_DATE), 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
            'totalDebit' VALUE SUM(RUNNING_TOTAL_DR),
            'totalCredit' VALUE SUM(RUNNING_TOTAL_CR),
            'postedBatches' VALUE SUM(CASE WHEN STATUS = 'P' THEN 1 ELSE 0 END),
            'unpostedBatches' VALUE SUM(CASE WHEN STATUS <> 'P' THEN 1 ELSE 0 END)
        )
        INTO v_json
        FROM RR_GL_JOURNAL_BATCHES;

        RETURN v_json;
    END GET_SYNC_STATS;

    -- ========================================================================
    -- GET_BATCHES_BY_PERIOD
    -- Description: Get all batches for a specific period
    -- ========================================================================
    FUNCTION GET_BATCHES_BY_PERIOD(
        p_period_name IN VARCHAR2
    ) RETURN CLOB AS
        v_json CLOB;
    BEGIN
        SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'batchSyncId' VALUE BATCH_SYNC_ID,
                'jeBatchId' VALUE JE_BATCH_ID,
                'batchName' VALUE BATCH_NAME,
                'status' VALUE STATUS,
                'statusMeaning' VALUE STATUS_MEANING,
                'postedDate' VALUE TO_CHAR(POSTED_DATE, 'YYYY-MM-DD'),
                'totalDr' VALUE RUNNING_TOTAL_DR,
                'totalCr' VALUE RUNNING_TOTAL_CR,
                'syncStatus' VALUE SYNC_STATUS
            )
            ORDER BY POSTED_DATE DESC
        )
        INTO v_json
        FROM RR_GL_JOURNAL_BATCHES
        WHERE DEFAULT_PERIOD_NAME = p_period_name;

        RETURN v_json;
    END GET_BATCHES_BY_PERIOD;

    -- ========================================================================
    -- MARK_BATCH_ERROR
    -- Description: Mark a batch as error
    -- ========================================================================
    PROCEDURE MARK_BATCH_ERROR(
        p_batch_sync_id IN NUMBER,
        p_error_message IN VARCHAR2
    ) AS
    BEGIN
        UPDATE RR_GL_JOURNAL_BATCHES
        SET
            SYNC_STATUS = 'ERROR',
            SYNC_ERROR_MESSAGE = p_error_message,
            LAST_UPDATE_DATE = SYSTIMESTAMP,
            LAST_UPDATED_BY = 'ERROR_HANDLER'
        WHERE BATCH_SYNC_ID = p_batch_sync_id;

        COMMIT;
    END MARK_BATCH_ERROR;

    -- ========================================================================
    -- GET_SYNC_SUMMARY
    -- Description: Get sync summary for a date range
    -- ========================================================================
    FUNCTION GET_SYNC_SUMMARY(
        p_from_date IN DATE DEFAULT NULL,
        p_to_date   IN DATE DEFAULT NULL
    ) RETURN CLOB AS
        v_json CLOB;
        v_from_date DATE;
        v_to_date   DATE;
    BEGIN
        v_from_date := NVL(p_from_date, TRUNC(SYSDATE) - 30);
        v_to_date   := NVL(p_to_date, TRUNC(SYSDATE) + 1);

        SELECT JSON_OBJECT(
            'fromDate' VALUE TO_CHAR(v_from_date, 'YYYY-MM-DD'),
            'toDate' VALUE TO_CHAR(v_to_date, 'YYYY-MM-DD'),
            'batchCount' VALUE COUNT(*),
            'syncedCount' VALUE SUM(CASE WHEN SYNC_STATUS = 'SYNCED' THEN 1 ELSE 0 END),
            'errorCount' VALUE SUM(CASE WHEN SYNC_STATUS = 'ERROR' THEN 1 ELSE 0 END),
            'totalDebit' VALUE SUM(RUNNING_TOTAL_DR),
            'totalCredit' VALUE SUM(RUNNING_TOTAL_CR),
            'periods' VALUE JSON_ARRAYAGG(
                DISTINCT JSON_OBJECT(
                    'periodName' VALUE DEFAULT_PERIOD_NAME,
                    'batchCount' VALUE COUNT(*) OVER (PARTITION BY DEFAULT_PERIOD_NAME)
                )
            )
        )
        INTO v_json
        FROM RR_GL_JOURNAL_BATCHES
        WHERE POSTED_DATE BETWEEN v_from_date AND v_to_date;

        RETURN v_json;
    END GET_SYNC_SUMMARY;

    -- ========================================================================
    -- CLEANUP_OLD_BATCHES
    -- Description: Delete old synced batches (data retention)
    -- ========================================================================
    PROCEDURE CLEANUP_OLD_BATCHES(
        p_days_old  IN NUMBER DEFAULT 90,
        p_deleted   OUT NUMBER
    ) AS
    BEGIN
        DELETE FROM RR_GL_JOURNAL_BATCHES
        WHERE SYNC_DATE < SYSTIMESTAMP - p_days_old
        AND SYNC_STATUS = 'SYNCED';

        p_deleted := SQL%ROWCOUNT;
        COMMIT;

        DBMS_OUTPUT.PUT_LINE('Deleted ' || p_deleted || ' old synced batches');
    END CLEANUP_OLD_BATCHES;

END RR_GL_PKG;
/

-- ============================================================================
-- CREATE ADDITIONAL ENDPOINTS FOR PACKAGE FUNCTIONS
-- ============================================================================

-- GET sync statistics
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr.gl',
        p_pattern        => 'stats',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Get GL sync statistics'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr.gl',
        p_pattern        => 'stats',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
BEGIN
    HTP.P(RR_GL_PKG.GET_SYNC_STATS);
    :status := 200;
EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
        :status := 500;
END;
]',
        p_comments       => 'GET sync statistics'
    );

    COMMIT;
END;
/

-- POST bulk sync
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr.gl',
        p_pattern        => 'bulksync',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Bulk sync multiple journal batches'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr.gl',
        p_pattern        => 'bulksync',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
DECLARE
    v_sync_count    NUMBER;
    v_error_count   NUMBER;
    v_message       VARCHAR2(4000);
BEGIN
    RR_GL_PKG.BULK_SYNC_BATCHES(
        p_json_array    => :body_text,
        p_sync_count    => v_sync_count,
        p_error_count   => v_error_count,
        p_message       => v_message
    );

    HTP.P('{');
    HTP.P('"status": "SUCCESS",');
    HTP.P('"syncedCount": ' || v_sync_count || ',');
    HTP.P('"errorCount": ' || v_error_count || ',');
    HTP.P('"message": "' || REPLACE(v_message, '"', '\"') || '"');
    HTP.P('}');

    :status := 200;
EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
        :status := 500;
END;
]',
        p_comments       => 'POST bulk sync journal batches'
    );

    COMMIT;
END;
/

PROMPT ✅ RR_GL_PKG package created successfully!
PROMPT ✅ GET /rr/gl/stats endpoint registered successfully!
PROMPT ✅ POST /rr/gl/bulksync endpoint registered successfully!
PROMPT;
PROMPT 📊 Available GL Endpoints:
PROMPT   - GET  /rr/gl/journalbatches (with pagination and filters)
PROMPT   - GET  /rr/gl/journalbatches/:id
PROMPT   - POST /rr/gl/journalbatches (sync single batch)
PROMPT   - POST /rr/gl/bulksync (sync multiple batches)
PROMPT   - GET  /rr/gl/stats (sync statistics)

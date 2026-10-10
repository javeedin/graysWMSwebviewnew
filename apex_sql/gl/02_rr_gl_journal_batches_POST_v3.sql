-- ============================================================================
-- RR_GL_JOURNAL_BATCHES POST HANDLER - FIXED
-- Description: Supports both single batch and Oracle Fusion "items" format
-- Method: POST
-- Endpoint: /rr/gl/journalbatches
-- Updated: 2025-11-10 - Fixed JSON_EXISTS check
-- ============================================================================

-- Drop and recreate the POST handler to support both formats
BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'rr.gl',
        p_pattern     => 'journalbatches',
        p_method      => 'POST'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Handler might not exist
END;
/

-- Recreate with proper format detection using JSON_EXISTS
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr.gl',
        p_pattern        => 'journalbatches',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
DECLARE
    v_result        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;
    v_has_items     BOOLEAN;
    v_sync_count    NUMBER := 0;
    v_error_count   NUMBER := 0;
BEGIN
    -- Get request body
    v_body := :body_text;

    -- Check if this is Oracle Fusion format with "items" array using JSON_EXISTS
    v_has_items := JSON_EXISTS(v_body, '$.items');

    IF v_has_items THEN
        -- Oracle Fusion format: { "items": [...] }
        -- Use bulk sync logic
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
            FROM JSON_TABLE(v_body, '$.items[*]' COLUMNS (value CLOB PATH '$'))
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
                    p_message                   => v_message
                );

                IF v_result = 'SUCCESS' THEN
                    v_sync_count := v_sync_count + 1;
                ELSE
                    v_error_count := v_error_count + 1;
                END IF;

            EXCEPTION
                WHEN OTHERS THEN
                    v_error_count := v_error_count + 1;
            END;
        END LOOP;

        -- Return bulk sync response
        HTP.P('{');
        HTP.P('"status": "SUCCESS",');
        HTP.P('"format": "fusion_items",');
        HTP.P('"syncedCount": ' || v_sync_count || ',');
        HTP.P('"errorCount": ' || v_error_count || ',');
        HTP.P('"message": "Bulk sync completed. Synced: ' || v_sync_count || ', Errors: ' || v_error_count || '"');
        HTP.P('}');

    ELSE
        -- Direct batch format: { "JeBatchId": ... }
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

        -- Return single batch response
        HTP.P('{');
        HTP.P('"status": "' || v_result || '",');
        HTP.P('"format": "direct_batch",');
        HTP.P('"message": "' || REPLACE(v_message, '"', '\"') || '"');
        HTP.P('}');
    END IF;

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
        p_comments       => 'POST handler - supports both single batch and Oracle Fusion items format'
    );

    COMMIT;
END;
/

PROMPT ✅ Fixed POST /rr/gl/journalbatches endpoint successfully!
PROMPT ✅ Changed JSON_VALUE to JSON_EXISTS for array detection
PROMPT ✅ Now supports both formats:
PROMPT    - Direct: { "JeBatchId": 123, ... }
PROMPT    - Fusion: { "items": [{ "JeBatchId": 123, ... }] }

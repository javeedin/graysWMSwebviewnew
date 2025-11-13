-- ============================================================================
-- RR_GL_JOURNAL_BATCHES POST HANDLER - SIMPLIFIED VERSION
-- Description: Uses JSON_VALUE with array indexing (compatible with all versions)
-- Method: POST - Supports both single batch and Oracle Fusion "items" format
-- Endpoint: /rr/gl/journalbatches
-- Updated: 2025-11-10
-- ============================================================================

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
    v_item_count    NUMBER := 0;
    v_idx           NUMBER;
    v_path          VARCHAR2(100);
BEGIN
    v_body := :body_text;

    -- Check if Oracle Fusion format with "items" array
    v_has_items := JSON_EXISTS(v_body, '$.items');

    IF v_has_items THEN
        -- Oracle Fusion format: Loop through items array
        -- First, count items in array
        BEGIN
            SELECT JSON_VALUE(v_body, '$.items.size()') INTO v_item_count FROM DUAL;
        EXCEPTION
            WHEN OTHERS THEN
                -- Alternative way to count: try to access items until error
                v_idx := 0;
                LOOP
                    v_path := '$.items[' || v_idx || '].JeBatchId';
                    BEGIN
                        IF JSON_VALUE(v_body, v_path) IS NULL AND v_idx > 0 THEN
                            EXIT;
                        END IF;
                        v_idx := v_idx + 1;
                        EXIT WHEN v_idx > 1000; -- Safety limit
                    EXCEPTION
                        WHEN OTHERS THEN
                            EXIT;
                    END;
                END LOOP;
                v_item_count := v_idx;
        END;

        -- Loop through each item
        FOR i IN 0 .. (v_item_count - 1)
        LOOP
            BEGIN
                v_path := '$.items[' || i || ']';

                RR_GL_SYNC_JOURNAL_BATCH(
                    p_je_batch_id               => JSON_VALUE(v_body, v_path || '.JeBatchId'),
                    p_accounted_period_type     => JSON_VALUE(v_body, v_path || '.AccountedPeriodType'),
                    p_default_period_name       => JSON_VALUE(v_body, v_path || '.DefaultPeriodName'),
                    p_batch_name                => JSON_VALUE(v_body, v_path || '.BatchName'),
                    p_status                    => JSON_VALUE(v_body, v_path || '.Status'),
                    p_control_total             => JSON_VALUE(v_body, v_path || '.ControlTotal'),
                    p_batch_description         => JSON_VALUE(v_body, v_path || '.BatchDescription'),
                    p_error_message             => JSON_VALUE(v_body, v_path || '.ErrorMessage'),
                    p_posted_date               => JSON_VALUE(v_body, v_path || '.PostedDate'),
                    p_posting_run_id            => JSON_VALUE(v_body, v_path || '.PostingRunId'),
                    p_request_id                => JSON_VALUE(v_body, v_path || '.RequestId'),
                    p_running_total_acct_cr     => JSON_VALUE(v_body, v_path || '.RunningTotalAccountedCr'),
                    p_running_total_acct_dr     => JSON_VALUE(v_body, v_path || '.RunningTotalAccountedDr'),
                    p_running_total_cr          => JSON_VALUE(v_body, v_path || '.RunningTotalCr'),
                    p_running_total_dr          => JSON_VALUE(v_body, v_path || '.RunningTotalDr'),
                    p_oracle_created_by         => JSON_VALUE(v_body, v_path || '.CreatedBy'),
                    p_oracle_creation_date      => JSON_VALUE(v_body, v_path || '.CreationDate'),
                    p_oracle_last_update_date   => JSON_VALUE(v_body, v_path || '.LastUpdateDate'),
                    p_oracle_last_updated_by    => JSON_VALUE(v_body, v_path || '.LastUpdatedBy'),
                    p_actual_flag_meaning       => JSON_VALUE(v_body, v_path || '.ActualFlagMeaning'),
                    p_approval_status_meaning   => JSON_VALUE(v_body, v_path || '.ApprovalStatusMeaning'),
                    p_approver_employee_name    => JSON_VALUE(v_body, v_path || '.ApproverEmployeeName'),
                    p_funds_status_meaning      => JSON_VALUE(v_body, v_path || '.FundsStatusMeaning'),
                    p_parent_je_batch_name      => JSON_VALUE(v_body, v_path || '.ParentJeBatchName'),
                    p_chart_of_accounts_name    => JSON_VALUE(v_body, v_path || '.ChartOfAccountsName'),
                    p_status_meaning            => JSON_VALUE(v_body, v_path || '.StatusMeaning'),
                    p_completion_status_meaning => JSON_VALUE(v_body, v_path || '.CompletionStatusMeaning'),
                    p_user_period_set_name      => JSON_VALUE(v_body, v_path || '.UserPeriodSetName'),
                    p_user_je_source_name       => JSON_VALUE(v_body, v_path || '.UserJeSourceName'),
                    p_reversal_date             => JSON_VALUE(v_body, v_path || '.ReversalDate'),
                    p_reversal_period           => JSON_VALUE(v_body, v_path || '.ReversalPeriod'),
                    p_reversal_flag             => JSON_VALUE(v_body, v_path || '.ReversalFlag'),
                    p_reversal_method_meaning   => JSON_VALUE(v_body, v_path || '.ReversalMethodMeaning'),
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
                    DBMS_OUTPUT.PUT_LINE('Batch ' || i || ' error: ' || SQLERRM);
            END;
        END LOOP;

        HTP.P('{');
        HTP.P('"status": "SUCCESS",');
        HTP.P('"format": "fusion_items",');
        HTP.P('"totalItems": ' || v_item_count || ',');
        HTP.P('"syncedCount": ' || v_sync_count || ',');
        HTP.P('"errorCount": ' || v_error_count || ',');
        HTP.P('"message": "Bulk sync completed. Total: ' || v_item_count || ', Synced: ' || v_sync_count || ', Errors: ' || v_error_count || '"');
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
        p_comments       => 'POST - Simple array indexing, supports Fusion items and direct batch'
    );

    COMMIT;
END;
/

PROMPT ✅ POST /rr/gl/journalbatches handler updated successfully!
PROMPT ✅ Using JSON_VALUE with array indexing (compatible with all Oracle versions)
PROMPT ✅ Supports: { "items": [{ ... }] } and { "JeBatchId": ... }
PROMPT ✅ Works without JSON_TABLE (simpler and more compatible)

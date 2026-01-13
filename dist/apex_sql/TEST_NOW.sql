-- ========================================
-- SIMPLE TEST SCRIPT - RUN THIS IN SQL DEVELOPER
-- ========================================
-- Copy and paste this entire script and run it
-- ========================================

-- Enable output so you can see results
SET SERVEROUTPUT ON SIZE 100000

-- Test 1: Check if tables exist and have data
-- ============================================
PROMPT ========================================
PROMPT TEST 1: Checking Tables
PROMPT ========================================

SELECT 'wms_printer_config' AS table_name, COUNT(*) AS row_count
FROM wms_printer_config
UNION ALL
SELECT 'wms_trip_config', COUNT(*)
FROM wms_trip_config
UNION ALL
SELECT 'wms_print_jobs', COUNT(*)
FROM wms_print_jobs;

PROMPT

-- Test 2: View printer configuration (simple query)
-- ==================================================
PROMPT ========================================
PROMPT TEST 2: Current Printer Configuration
PROMPT ========================================

SELECT
    config_id,
    printer_name,
    fusion_instance,
    fusion_username,
    auto_print,
    is_active
FROM wms_printer_config
WHERE is_active = 'Y';

PROMPT

-- Test 3: Call wms_get_printer_config procedure
-- ==============================================
PROMPT ========================================
PROMPT TEST 3: Testing wms_get_printer_config Procedure
PROMPT ========================================

DECLARE
    v_cursor SYS_REFCURSOR;

    -- Variables to hold fetched data
    v_config_id         NUMBER;
    v_printer_name      VARCHAR2(200);
    v_paper_size        VARCHAR2(50);
    v_orientation       VARCHAR2(20);
    v_fusion_instance   VARCHAR2(20);
    v_fusion_username   VARCHAR2(100);
    v_fusion_password   VARCHAR2(200);
    v_auto_download     VARCHAR2(1);
    v_auto_print        VARCHAR2(1);
    v_is_active         VARCHAR2(1);
    v_created_date      DATE;
    v_modified_date     DATE;

    v_found BOOLEAN := FALSE;
BEGIN
    -- Call the procedure
    wms_get_printer_config(p_cursor => v_cursor);

    -- Fetch results
    LOOP
        FETCH v_cursor INTO
            v_config_id,
            v_printer_name,
            v_paper_size,
            v_orientation,
            v_fusion_instance,
            v_fusion_username,
            v_fusion_password,
            v_auto_download,
            v_auto_print,
            v_is_active,
            v_created_date,
            v_modified_date;

        EXIT WHEN v_cursor%NOTFOUND;

        v_found := TRUE;

        DBMS_OUTPUT.PUT_LINE('Config ID      : ' || v_config_id);
        DBMS_OUTPUT.PUT_LINE('Printer Name   : ' || v_printer_name);
        DBMS_OUTPUT.PUT_LINE('Paper Size     : ' || v_paper_size);
        DBMS_OUTPUT.PUT_LINE('Orientation    : ' || v_orientation);
        DBMS_OUTPUT.PUT_LINE('Fusion Instance: ' || v_fusion_instance);
        DBMS_OUTPUT.PUT_LINE('Fusion Username: ' || v_fusion_username);
        DBMS_OUTPUT.PUT_LINE('Auto Download  : ' || v_auto_download);
        DBMS_OUTPUT.PUT_LINE('Auto Print     : ' || v_auto_print);
        DBMS_OUTPUT.PUT_LINE('Is Active      : ' || v_is_active);
        DBMS_OUTPUT.PUT_LINE('Created Date   : ' || TO_CHAR(v_created_date, 'YYYY-MM-DD HH24:MI:SS'));
        DBMS_OUTPUT.PUT_LINE('---');
    END LOOP;

    CLOSE v_cursor;

    IF v_found THEN
        DBMS_OUTPUT.PUT_LINE('✅ Procedure executed successfully!');
    ELSE
        DBMS_OUTPUT.PUT_LINE('⚠️  No printer configuration found. Run 05_test_data.sql first.');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('❌ ERROR: ' || SQLERRM);
        DBMS_OUTPUT.PUT_LINE('Stack Trace: ' || DBMS_UTILITY.FORMAT_ERROR_BACKTRACE);

        IF v_cursor%ISOPEN THEN
            CLOSE v_cursor;
        END IF;
END;
/

PROMPT

-- Test 4: View print jobs (simple query)
-- =======================================
PROMPT ========================================
PROMPT TEST 4: Recent Print Jobs
PROMPT ========================================

SELECT
    print_job_id,
    order_number,
    trip_id,
    TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date,
    overall_status,
    TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI:SS') AS created
FROM wms_print_jobs
ORDER BY created_date DESC
FETCH FIRST 10 ROWS ONLY;

PROMPT

-- Test 5: Call wms_get_all_print_jobs procedure
-- ==============================================
PROMPT ========================================
PROMPT TEST 5: Testing wms_get_all_print_jobs Procedure
PROMPT ========================================

DECLARE
    v_cursor SYS_REFCURSOR;

    -- Record type matching the cursor columns
    v_job_id        NUMBER;
    v_order_number  VARCHAR2(50);
    v_trip_id       VARCHAR2(50);
    v_status        VARCHAR2(20);

    v_count NUMBER := 0;
BEGIN
    -- Call the procedure
    wms_get_all_print_jobs(
        p_start_date => SYSDATE - 30,
        p_end_date => SYSDATE + 1,
        p_status_filter => NULL,
        p_cursor => v_cursor
    );

    DBMS_OUTPUT.PUT_LINE('Print Jobs (Last 30 Days):');
    DBMS_OUTPUT.PUT_LINE('---');

    -- Fetch first few columns only (simplified)
    LOOP
        FETCH v_cursor INTO
            v_job_id,
            v_order_number,
            v_trip_id,
            v_status;

        EXIT WHEN v_cursor%NOTFOUND;

        v_count := v_count + 1;

        DBMS_OUTPUT.PUT_LINE('Job #' || v_count || ': ' ||
            'Order=' || v_order_number || ', ' ||
            'Trip=' || v_trip_id || ', ' ||
            'Status=' || v_status);

        -- Limit output to first 10
        EXIT WHEN v_count >= 10;
    END LOOP;

    CLOSE v_cursor;

    DBMS_OUTPUT.PUT_LINE('---');
    DBMS_OUTPUT.PUT_LINE('Total jobs found (showing first 10): ' || v_count);

    IF v_count > 0 THEN
        DBMS_OUTPUT.PUT_LINE('✅ Procedure executed successfully!');
    ELSE
        DBMS_OUTPUT.PUT_LINE('⚠️  No print jobs found. Run 05_test_data.sql first.');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('❌ ERROR: ' || SQLERRM);
        IF v_cursor%ISOPEN THEN
            CLOSE v_cursor;
        END IF;
END;
/

PROMPT

-- Test 6: Save a test printer configuration
-- ==========================================
PROMPT ========================================
PROMPT TEST 6: Testing wms_save_printer_config Procedure
PROMPT ========================================

DECLARE
    v_result VARCHAR2(100);
    v_config_id NUMBER;
BEGIN
    wms_save_printer_config(
        p_printer_name => 'Test Printer - SQL Test',
        p_paper_size => 'A4',
        p_orientation => 'Portrait',
        p_fusion_instance => 'TEST',
        p_fusion_username => 'test_user',
        p_fusion_password => 'test_pass',
        p_auto_download => 'Y',
        p_auto_print => 'Y',
        p_result => v_result,
        p_config_id => v_config_id
    );

    DBMS_OUTPUT.PUT_LINE('Result     : ' || v_result);
    DBMS_OUTPUT.PUT_LINE('Config ID  : ' || v_config_id);

    IF v_result = 'SUCCESS' THEN
        DBMS_OUTPUT.PUT_LINE('✅ Procedure executed successfully!');
    ELSE
        DBMS_OUTPUT.PUT_LINE('❌ Procedure failed: ' || v_result);
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('❌ ERROR: ' || SQLERRM);
END;
/

PROMPT
PROMPT ========================================
PROMPT ALL TESTS COMPLETED
PROMPT ========================================
PROMPT
PROMPT If you see errors above, check:
PROMPT 1. Tables exist: Run 01_create_tables.sql
PROMPT 2. Procedures exist: Run 02_post_procedures.sql and 03_get_procedures.sql
PROMPT 3. Test data exists: Run 05_test_data.sql
PROMPT

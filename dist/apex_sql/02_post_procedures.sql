-- ========================================
-- WMS TRIP MANAGEMENT - POST PROCEDURES
-- ========================================
-- Created: 2025-11-05
-- Purpose: APEX REST procedures to store trip and print job data
-- ========================================

-- ========================================
-- PROCEDURE 1: SAVE/UPDATE PRINTER CONFIG
-- ========================================
CREATE OR REPLACE PROCEDURE wms_save_printer_config (
    p_printer_name      IN VARCHAR2,
    p_paper_size        IN VARCHAR2 DEFAULT 'A4',
    p_orientation       IN VARCHAR2 DEFAULT 'Portrait',
    p_fusion_instance   IN VARCHAR2 DEFAULT 'TEST',
    p_fusion_username   IN VARCHAR2,
    p_fusion_password   IN VARCHAR2,
    p_auto_download     IN VARCHAR2 DEFAULT 'Y',
    p_auto_print        IN VARCHAR2 DEFAULT 'Y',
    p_result            OUT VARCHAR2,
    p_config_id         OUT NUMBER
) AS
    v_count NUMBER;
BEGIN
    -- Deactivate all existing configs
    UPDATE wms_printer_config
    SET is_active = 'N',
        modified_by = USER,
        modified_date = SYSDATE
    WHERE is_active = 'Y';

    -- Insert new config
    INSERT INTO wms_printer_config (
        printer_name, paper_size, orientation,
        fusion_instance, fusion_username, fusion_password,
        auto_download, auto_print, is_active
    ) VALUES (
        p_printer_name, p_paper_size, p_orientation,
        p_fusion_instance, p_fusion_username, p_fusion_password,
        p_auto_download, p_auto_print, 'Y'
    ) RETURNING config_id INTO p_config_id;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
        p_config_id := NULL;
END wms_save_printer_config;
/


-- ========================================
-- PROCEDURE 2: ENABLE AUTO-PRINT FOR TRIP
-- ========================================
CREATE OR REPLACE PROCEDURE wms_enable_auto_print (
    p_trip_id           IN VARCHAR2,
    p_trip_date         IN DATE,
    p_orders_json       IN CLOB,  -- JSON array of orders
    p_result            OUT VARCHAR2,
    p_trip_config_id    OUT NUMBER,
    p_orders_created    OUT NUMBER
) AS
    v_trip_config_id    NUMBER;
    v_order_count       NUMBER := 0;

    -- Variables for JSON parsing
    v_order_number      VARCHAR2(50);
    v_customer_name     VARCHAR2(200);
    v_account_number    VARCHAR2(50);
    v_order_date        DATE;
BEGIN
    -- Check if trip config already exists
    BEGIN
        SELECT trip_config_id
        INTO v_trip_config_id
        FROM wms_trip_config
        WHERE trip_id = p_trip_id
          AND trip_date = p_trip_date;

        -- Update existing config
        UPDATE wms_trip_config
        SET auto_print_enabled = 'Y',
            enabled_by = USER,
            enabled_date = SYSDATE,
            modified_by = USER,
            modified_date = SYSDATE
        WHERE trip_config_id = v_trip_config_id;

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            -- Create new trip config
            INSERT INTO wms_trip_config (
                trip_id, trip_date, auto_print_enabled,
                enabled_by, enabled_date
            ) VALUES (
                p_trip_id, p_trip_date, 'Y',
                USER, SYSDATE
            ) RETURNING trip_config_id INTO v_trip_config_id;
    END;

    -- Delete existing print jobs for this trip (if any)
    DELETE FROM wms_print_jobs
    WHERE trip_config_id = v_trip_config_id;

    -- Parse JSON and insert print jobs
    -- Using JSON_TABLE (Oracle 12c+)
    FOR order_rec IN (
        SELECT
            jt.order_number,
            jt.customer_name,
            jt.account_number,
            TO_DATE(jt.order_date, 'YYYY-MM-DD') AS order_date
        FROM JSON_TABLE(
            p_orders_json, '$[*]'
            COLUMNS (
                order_number    VARCHAR2(50)  PATH '$.orderNumber',
                customer_name   VARCHAR2(200) PATH '$.customerName',
                account_number  VARCHAR2(50)  PATH '$.accountNumber',
                order_date      VARCHAR2(20)  PATH '$.orderDate'
            )
        ) jt
    ) LOOP
        INSERT INTO wms_print_jobs (
            trip_config_id, order_number, trip_id, trip_date,
            customer_name, account_number, order_date,
            download_status, print_status, overall_status
        ) VALUES (
            v_trip_config_id, order_rec.order_number, p_trip_id, p_trip_date,
            order_rec.customer_name, order_rec.account_number, order_rec.order_date,
            'Pending', 'Pending', 'Pending'
        );

        v_order_count := v_order_count + 1;
    END LOOP;

    -- Update trip config with order count
    UPDATE wms_trip_config
    SET total_orders = v_order_count,
        modified_by = USER,
        modified_date = SYSDATE
    WHERE trip_config_id = v_trip_config_id;

    COMMIT;

    p_result := 'SUCCESS';
    p_trip_config_id := v_trip_config_id;
    p_orders_created := v_order_count;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
        p_trip_config_id := NULL;
        p_orders_created := 0;
END wms_enable_auto_print;
/


-- ========================================
-- PROCEDURE 3: DISABLE AUTO-PRINT FOR TRIP
-- ========================================
CREATE OR REPLACE PROCEDURE wms_disable_auto_print (
    p_trip_id           IN VARCHAR2,
    p_trip_date         IN DATE,
    p_result            OUT VARCHAR2
) AS
    v_trip_config_id    NUMBER;
BEGIN
    -- Find trip config
    SELECT trip_config_id
    INTO v_trip_config_id
    FROM wms_trip_config
    WHERE trip_id = p_trip_id
      AND trip_date = p_trip_date;

    -- Update config
    UPDATE wms_trip_config
    SET auto_print_enabled = 'N',
        disabled_by = USER,
        disabled_date = SYSDATE,
        modified_by = USER,
        modified_date = SYSDATE
    WHERE trip_config_id = v_trip_config_id;

    -- Optional: Delete pending print jobs
    -- Uncomment if you want to clean up pending jobs
    /*
    DELETE FROM wms_print_jobs
    WHERE trip_config_id = v_trip_config_id
      AND overall_status = 'Pending';
    */

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN NO_DATA_FOUND THEN
        p_result := 'ERROR: Trip not found';
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_disable_auto_print;
/


-- ========================================
-- PROCEDURE 4: UPDATE PRINT JOB STATUS
-- ========================================
CREATE OR REPLACE PROCEDURE wms_update_print_job (
    p_order_number      IN VARCHAR2,
    p_trip_id           IN VARCHAR2,
    p_trip_date         IN DATE,
    p_download_status   IN VARCHAR2 DEFAULT NULL,
    p_print_status      IN VARCHAR2 DEFAULT NULL,
    p_file_path         IN VARCHAR2 DEFAULT NULL,
    p_file_size_bytes   IN NUMBER DEFAULT NULL,
    p_error_message     IN VARCHAR2 DEFAULT NULL,
    p_result            OUT VARCHAR2,
    p_print_job_id      OUT NUMBER
) AS
    v_print_job_id      NUMBER;
    v_old_status        VARCHAR2(20);
    v_new_status        VARCHAR2(20);
    v_trip_config_id    NUMBER;
BEGIN
    -- Find the print job
    SELECT pj.print_job_id, pj.overall_status, pj.trip_config_id
    INTO v_print_job_id, v_old_status, v_trip_config_id
    FROM wms_print_jobs pj
    WHERE pj.order_number = p_order_number
      AND pj.trip_id = p_trip_id
      AND pj.trip_date = p_trip_date;

    -- Update print job
    UPDATE wms_print_jobs
    SET download_status = COALESCE(p_download_status, download_status),
        print_status = COALESCE(p_print_status, print_status),
        file_path = COALESCE(p_file_path, file_path),
        file_size_bytes = COALESCE(p_file_size_bytes, file_size_bytes),
        error_message = COALESCE(p_error_message, error_message),
        modified_by = USER,
        modified_date = SYSDATE,
        download_completed = CASE WHEN p_download_status = 'Completed' THEN SYSDATE ELSE download_completed END,
        download_started = CASE WHEN p_download_status = 'Downloading' AND download_started IS NULL THEN SYSDATE ELSE download_started END,
        print_completed = CASE WHEN p_print_status = 'Printed' THEN SYSDATE ELSE print_completed END,
        print_started = CASE WHEN p_print_status = 'Printing' AND print_started IS NULL THEN SYSDATE ELSE print_started END,
        retry_count = CASE WHEN p_download_status = 'Failed' OR p_print_status = 'Failed' THEN retry_count + 1 ELSE retry_count END,
        overall_status = CASE
            WHEN p_print_status = 'Printed' THEN 'Completed'
            WHEN p_print_status = 'Printing' THEN 'Printing'
            WHEN p_print_status = 'Failed' THEN 'Failed'
            WHEN p_download_status = 'Failed' THEN 'Failed'
            WHEN p_download_status = 'Completed' THEN 'Downloaded'
            WHEN p_download_status = 'Downloading' THEN 'Downloading'
            ELSE overall_status
        END
    WHERE print_job_id = v_print_job_id
    RETURNING overall_status INTO v_new_status;

    -- Log to history
    INSERT INTO wms_print_job_history (
        print_job_id, action_type, old_status, new_status, message
    ) VALUES (
        v_print_job_id,
        CASE
            WHEN p_download_status IS NOT NULL THEN 'DOWNLOAD_STATUS_CHANGE'
            WHEN p_print_status IS NOT NULL THEN 'PRINT_STATUS_CHANGE'
            ELSE 'STATUS_UPDATE'
        END,
        v_old_status, v_new_status,
        COALESCE(p_error_message, 'Status updated successfully')
    );

    -- Update trip-level statistics
    UPDATE wms_trip_config tc
    SET downloaded_orders = (
            SELECT COUNT(*) FROM wms_print_jobs
            WHERE trip_config_id = tc.trip_config_id
              AND download_status = 'Completed'
        ),
        printed_orders = (
            SELECT COUNT(*) FROM wms_print_jobs
            WHERE trip_config_id = tc.trip_config_id
              AND print_status = 'Printed'
        ),
        failed_orders = (
            SELECT COUNT(*) FROM wms_print_jobs
            WHERE trip_config_id = tc.trip_config_id
              AND overall_status = 'Failed'
        ),
        modified_by = USER,
        modified_date = SYSDATE
    WHERE tc.trip_config_id = v_trip_config_id;

    COMMIT;

    p_result := 'SUCCESS';
    p_print_job_id := v_print_job_id;

EXCEPTION
    WHEN NO_DATA_FOUND THEN
        p_result := 'ERROR: Print job not found';
        p_print_job_id := NULL;
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
        p_print_job_id := NULL;
END wms_update_print_job;
/


-- ========================================
-- PROCEDURE 5: BULK UPDATE PRINT JOBS
-- ========================================
CREATE OR REPLACE PROCEDURE wms_bulk_update_jobs (
    p_jobs_json         IN CLOB,  -- JSON array with job updates
    p_result            OUT VARCHAR2,
    p_updated_count     OUT NUMBER
) AS
    v_count NUMBER := 0;
    v_result VARCHAR2(100);
    v_job_id NUMBER;
BEGIN
    FOR job_rec IN (
        SELECT
            jt.order_number,
            jt.trip_id,
            TO_DATE(jt.trip_date, 'YYYY-MM-DD') AS trip_date,
            jt.download_status,
            jt.print_status,
            jt.file_path,
            jt.error_message
        FROM JSON_TABLE(
            p_jobs_json, '$[*]'
            COLUMNS (
                order_number    VARCHAR2(50)  PATH '$.orderNumber',
                trip_id         VARCHAR2(50)  PATH '$.tripId',
                trip_date       VARCHAR2(20)  PATH '$.tripDate',
                download_status VARCHAR2(20)  PATH '$.downloadStatus',
                print_status    VARCHAR2(20)  PATH '$.printStatus',
                file_path       VARCHAR2(500) PATH '$.filePath',
                error_message   VARCHAR2(500) PATH '$.errorMessage'
            )
        ) jt
    ) LOOP
        wms_update_print_job(
            p_order_number => job_rec.order_number,
            p_trip_id => job_rec.trip_id,
            p_trip_date => job_rec.trip_date,
            p_download_status => job_rec.download_status,
            p_print_status => job_rec.print_status,
            p_file_path => job_rec.file_path,
            p_error_message => job_rec.error_message,
            p_result => v_result,
            p_print_job_id => v_job_id
        );

        IF v_result = 'SUCCESS' THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    p_result := 'SUCCESS';
    p_updated_count := v_count;

EXCEPTION
    WHEN OTHERS THEN
        p_result := 'ERROR: ' || SQLERRM;
        p_updated_count := 0;
END wms_bulk_update_jobs;
/


-- ========================================
-- SHOW COMPILATION ERRORS
-- ========================================
SHOW ERRORS;

-- ========================================
-- END OF POST PROCEDURES
-- ========================================

-- ========================================
-- WMS TRIP MANAGEMENT - GET PROCEDURES
-- ========================================
-- Created: 2025-11-05
-- Purpose: APEX REST procedures to retrieve trip and print job data
-- ========================================

-- ========================================
-- PROCEDURE 1: GET PRINTER CONFIG
-- ========================================
CREATE OR REPLACE PROCEDURE wms_get_printer_config (
    p_cursor OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        config_id,
        printer_name,
        paper_size,
        orientation,
        fusion_instance,
        fusion_username,
        fusion_password,
        auto_download,
        auto_print,
        is_active,
        created_date,
        modified_date
    FROM wms_printer_config
    WHERE is_active = 'Y'
    ORDER BY created_date DESC
    FETCH FIRST 1 ROW ONLY;
END wms_get_printer_config;
/


-- ========================================
-- PROCEDURE 2: GET ALL PRINT JOBS
-- ========================================
CREATE OR REPLACE PROCEDURE wms_get_all_print_jobs (
    p_start_date        IN DATE DEFAULT NULL,
    p_end_date          IN DATE DEFAULT NULL,
    p_status_filter     IN VARCHAR2 DEFAULT NULL,
    p_cursor            OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        pj.print_job_id,
        pj.order_number,
        pj.trip_id,
        pj.trip_date,
        pj.customer_name,
        pj.account_number,
        pj.order_date,
        pj.download_status,
        pj.print_status,
        pj.overall_status AS status,
        pj.file_path,
        pj.file_size_bytes,
        pj.error_message,
        pj.retry_count,
        pj.download_started,
        pj.download_completed,
        pj.print_started,
        pj.print_completed,
        pj.created_date,
        pj.modified_date,
        tc.auto_print_enabled,
        tc.total_orders AS trip_total_orders
    FROM wms_print_jobs pj
    INNER JOIN wms_trip_config tc ON pj.trip_config_id = tc.trip_config_id
    WHERE 1=1
      AND (p_start_date IS NULL OR pj.trip_date >= p_start_date)
      AND (p_end_date IS NULL OR pj.trip_date <= p_end_date)
      AND (p_status_filter IS NULL OR pj.overall_status = p_status_filter)
    ORDER BY pj.trip_date DESC, pj.trip_id, pj.order_number;
END wms_get_all_print_jobs;
/


-- ========================================
-- PROCEDURE 3: GET PRINT JOBS BY TRIP
-- ========================================
CREATE OR REPLACE PROCEDURE wms_get_trip_print_jobs (
    p_trip_id           IN VARCHAR2,
    p_trip_date         IN DATE,
    p_cursor            OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        pj.print_job_id,
        pj.order_number,
        pj.trip_id,
        pj.trip_date,
        pj.customer_name,
        pj.account_number,
        pj.order_date,
        pj.download_status,
        pj.print_status,
        pj.overall_status AS status,
        pj.file_path,
        pj.file_size_bytes,
        pj.error_message,
        pj.retry_count,
        pj.download_started,
        pj.download_completed,
        pj.print_started,
        pj.print_completed,
        pj.created_date
    FROM wms_print_jobs pj
    INNER JOIN wms_trip_config tc ON pj.trip_config_id = tc.trip_config_id
    WHERE pj.trip_id = p_trip_id
      AND pj.trip_date = p_trip_date
    ORDER BY pj.order_number;
END wms_get_trip_print_jobs;
/


-- ========================================
-- PROCEDURE 4: GET PRINT JOB STATISTICS
-- ========================================
CREATE OR REPLACE PROCEDURE wms_get_print_job_stats (
    p_start_date        IN DATE DEFAULT NULL,
    p_end_date          IN DATE DEFAULT NULL,
    p_cursor            OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        COUNT(*) AS total_jobs,
        SUM(CASE WHEN overall_status = 'Pending' THEN 1 ELSE 0 END) AS pending_download,
        SUM(CASE WHEN overall_status = 'Downloading' THEN 1 ELSE 0 END) AS downloading,
        SUM(CASE WHEN overall_status = 'Downloaded' THEN 1 ELSE 0 END) AS download_completed,
        SUM(CASE WHEN overall_status = 'Printing' THEN 1 ELSE 0 END) AS pending_print,
        SUM(CASE WHEN overall_status = 'Completed' THEN 1 ELSE 0 END) AS printed,
        SUM(CASE WHEN overall_status = 'Failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) AS retried_jobs,
        AVG(retry_count) AS avg_retry_count,
        ROUND(AVG(
            CASE WHEN download_completed IS NOT NULL AND download_started IS NOT NULL
            THEN (download_completed - download_started) * 24 * 60 * 60
            ELSE NULL END
        ), 2) AS avg_download_time_seconds
    FROM wms_print_jobs
    WHERE 1=1
      AND (p_start_date IS NULL OR trip_date >= p_start_date)
      AND (p_end_date IS NULL OR trip_date <= p_end_date);
END wms_get_print_job_stats;
/


-- ========================================
-- PROCEDURE 5: GET TRIP CONFIGURATIONS
-- ========================================
CREATE OR REPLACE PROCEDURE wms_get_trip_configs (
    p_start_date        IN DATE DEFAULT NULL,
    p_end_date          IN DATE DEFAULT NULL,
    p_enabled_only      IN VARCHAR2 DEFAULT 'N',
    p_cursor            OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        tc.trip_config_id,
        tc.trip_id,
        tc.trip_date,
        tc.auto_print_enabled,
        tc.total_orders,
        tc.downloaded_orders,
        tc.printed_orders,
        tc.failed_orders,
        tc.enabled_by,
        tc.enabled_date,
        tc.disabled_by,
        tc.disabled_date,
        tc.created_date,
        tc.modified_date,
        -- Calculate progress percentage
        CASE
            WHEN tc.total_orders > 0
            THEN ROUND((tc.printed_orders / tc.total_orders) * 100, 2)
            ELSE 0
        END AS progress_percentage,
        -- Calculate status
        CASE
            WHEN tc.failed_orders > 0 THEN 'Failed'
            WHEN tc.printed_orders = tc.total_orders THEN 'Completed'
            WHEN tc.downloaded_orders > 0 THEN 'In Progress'
            ELSE 'Pending'
        END AS trip_status
    FROM wms_trip_config tc
    WHERE 1=1
      AND (p_start_date IS NULL OR tc.trip_date >= p_start_date)
      AND (p_end_date IS NULL OR tc.trip_date <= p_end_date)
      AND (p_enabled_only = 'N' OR tc.auto_print_enabled = 'Y')
    ORDER BY tc.trip_date DESC, tc.trip_id;
END wms_get_trip_configs;
/


-- ========================================
-- PROCEDURE 6: GET PRINT JOB HISTORY
-- ========================================
CREATE OR REPLACE PROCEDURE wms_get_print_job_history (
    p_print_job_id      IN NUMBER,
    p_cursor            OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        h.history_id,
        h.print_job_id,
        h.action_type,
        h.old_status,
        h.new_status,
        h.message,
        h.action_by,
        h.action_date,
        pj.order_number,
        pj.trip_id
    FROM wms_print_job_history h
    INNER JOIN wms_print_jobs pj ON h.print_job_id = pj.print_job_id
    WHERE h.print_job_id = p_print_job_id
    ORDER BY h.action_date DESC;
END wms_get_print_job_history;
/


-- ========================================
-- PROCEDURE 7: GET FAILED JOBS FOR RETRY
-- ========================================
CREATE OR REPLACE PROCEDURE wms_get_failed_jobs (
    p_trip_id           IN VARCHAR2 DEFAULT NULL,
    p_trip_date         IN DATE DEFAULT NULL,
    p_cursor            OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        pj.print_job_id,
        pj.order_number,
        pj.trip_id,
        pj.trip_date,
        pj.customer_name,
        pj.overall_status,
        pj.error_message,
        pj.retry_count,
        pj.modified_date AS last_attempt
    FROM wms_print_jobs pj
    WHERE pj.overall_status = 'Failed'
      AND (p_trip_id IS NULL OR pj.trip_id = p_trip_id)
      AND (p_trip_date IS NULL OR pj.trip_date = p_trip_date)
    ORDER BY pj.trip_date DESC, pj.retry_count ASC;
END wms_get_failed_jobs;
/


-- ========================================
-- PROCEDURE 8: GET TRIP SUMMARY (Dashboard)
-- ========================================
CREATE OR REPLACE PROCEDURE wms_get_trip_summary (
    p_start_date        IN DATE DEFAULT NULL,
    p_end_date          IN DATE DEFAULT NULL,
    p_cursor            OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        tc.trip_id,
        tc.trip_date,
        tc.total_orders,
        tc.downloaded_orders,
        tc.printed_orders,
        tc.failed_orders,
        tc.auto_print_enabled,
        -- Calculate completion percentage
        CASE
            WHEN tc.total_orders > 0
            THEN ROUND((tc.printed_orders / tc.total_orders) * 100, 2)
            ELSE 0
        END AS completion_pct,
        -- Calculate failure rate
        CASE
            WHEN tc.total_orders > 0
            THEN ROUND((tc.failed_orders / tc.total_orders) * 100, 2)
            ELSE 0
        END AS failure_pct,
        -- Status
        CASE
            WHEN tc.printed_orders = tc.total_orders THEN 'Completed'
            WHEN tc.failed_orders > 0 THEN 'Has Failures'
            WHEN tc.downloaded_orders > 0 THEN 'In Progress'
            ELSE 'Pending'
        END AS status,
        -- Time metrics
        MIN(pj.download_started) AS first_download_start,
        MAX(pj.print_completed) AS last_print_complete,
        -- Average processing time
        ROUND(AVG(
            CASE
                WHEN pj.print_completed IS NOT NULL AND pj.download_started IS NOT NULL
                THEN (pj.print_completed - pj.download_started) * 24 * 60
                ELSE NULL
            END
        ), 2) AS avg_processing_minutes
    FROM wms_trip_config tc
    LEFT JOIN wms_print_jobs pj ON tc.trip_config_id = pj.trip_config_id
    WHERE 1=1
      AND (p_start_date IS NULL OR tc.trip_date >= p_start_date)
      AND (p_end_date IS NULL OR tc.trip_date <= p_end_date)
    GROUP BY
        tc.trip_id,
        tc.trip_date,
        tc.total_orders,
        tc.downloaded_orders,
        tc.printed_orders,
        tc.failed_orders,
        tc.auto_print_enabled
    ORDER BY tc.trip_date DESC, tc.trip_id;
END wms_get_trip_summary;
/


-- ========================================
-- FUNCTION: GET SINGLE PRINT JOB (Returns JSON)
-- ========================================
CREATE OR REPLACE FUNCTION wms_get_print_job_json (
    p_order_number      IN VARCHAR2,
    p_trip_id           IN VARCHAR2,
    p_trip_date         IN DATE
) RETURN CLOB AS
    v_json CLOB;
BEGIN
    SELECT JSON_OBJECT(
        'printJobId'        VALUE print_job_id,
        'orderNumber'       VALUE order_number,
        'tripId'            VALUE trip_id,
        'tripDate'          VALUE TO_CHAR(trip_date, 'YYYY-MM-DD'),
        'customerName'      VALUE customer_name,
        'accountNumber'     VALUE account_number,
        'downloadStatus'    VALUE download_status,
        'printStatus'       VALUE print_status,
        'overallStatus'     VALUE overall_status,
        'filePath'          VALUE file_path,
        'fileSizeBytes'     VALUE file_size_bytes,
        'errorMessage'      VALUE error_message,
        'retryCount'        VALUE retry_count,
        'createdDate'       VALUE TO_CHAR(created_date, 'YYYY-MM-DD"T"HH24:MI:SS')
    )
    INTO v_json
    FROM wms_print_jobs
    WHERE order_number = p_order_number
      AND trip_id = p_trip_id
      AND trip_date = p_trip_date;

    RETURN v_json;

EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RETURN JSON_OBJECT('error' VALUE 'Print job not found');
    WHEN OTHERS THEN
        RETURN JSON_OBJECT('error' VALUE SQLERRM);
END wms_get_print_job_json;
/


-- ========================================
-- SHOW COMPILATION ERRORS
-- ========================================
SHOW ERRORS;

-- ========================================
-- END OF GET PROCEDURES
-- ========================================

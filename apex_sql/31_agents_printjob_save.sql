-- ============================================================
-- APEX REST HANDLER — POST printjobs/save
-- ============================================================
-- Module:       TRIPMANAGEMENT
-- URI Template: printjobs/save
-- Method:       POST
-- Source Type:  PL/SQL
-- ============================================================
-- Called from shipping-agent.js saPrintOrder() after a PDF
-- is successfully downloaded and verified.
--
-- Ensures wms_trip_config row exists (MERGE), then inserts
-- a new wms_print_jobs record for the downloaded order PDF.
-- ============================================================
-- Body JSON:
-- {
--   "orderNumber":    "75626003240",
--   "tripId":         "5279",
--   "tripDate":       "2025-06-06",
--   "instanceName":   "PROD",
--   "filePath":       "C:\\fusion\\orderpdfdownloads\\2025-06-06\\5279\\75626003240.pdf",
--   "fileSizeBytes":  54320,
--   "downloadStatus": "Completed",
--   "printStatus":    "Pending",
--   "overallStatus":  "Downloaded",
--   "customerName":   "ACME Ltd",
--   "accountNumber":  "ACC-001"
-- }
-- ============================================================
DECLARE
    v_order_number    VARCHAR2(50);
    v_trip_id         VARCHAR2(50);
    v_trip_date       DATE;
    v_instance_name   VARCHAR2(20);
    v_file_path       VARCHAR2(500);
    v_file_size       NUMBER;
    v_download_status VARCHAR2(20);
    v_print_status    VARCHAR2(20);
    v_overall_status  VARCHAR2(20);
    v_customer_name   VARCHAR2(200);
    v_account_number  VARCHAR2(50);
    v_trip_config_id  NUMBER;
    v_body            CLOB;
BEGIN
    v_body := :body;
    APEX_JSON.parse(v_body);

    v_order_number    := APEX_JSON.get_varchar2('orderNumber');
    v_trip_id         := APEX_JSON.get_varchar2('tripId');
    v_trip_date       := NVL(TO_DATE(APEX_JSON.get_varchar2('tripDate'), 'YYYY-MM-DD'), TRUNC(SYSDATE));
    v_instance_name   := NVL(UPPER(APEX_JSON.get_varchar2('instanceName')), 'PROD');
    v_file_path       := APEX_JSON.get_varchar2('filePath');
    v_file_size       := NVL(APEX_JSON.get_number('fileSizeBytes'), 0);
    v_download_status := NVL(APEX_JSON.get_varchar2('downloadStatus'), 'Completed');
    v_print_status    := NVL(APEX_JSON.get_varchar2('printStatus'),    'Pending');
    v_overall_status  := NVL(APEX_JSON.get_varchar2('overallStatus'),  'Downloaded');
    v_customer_name   := APEX_JSON.get_varchar2('customerName');
    v_account_number  := APEX_JSON.get_varchar2('accountNumber');

    -- Ensure wms_trip_config row exists for this trip/date (required by FK)
    MERGE INTO wms_trip_config tc
    USING (SELECT v_trip_id AS trip_id, v_trip_date AS trip_date FROM dual) src
       ON (tc.trip_id = src.trip_id AND tc.trip_date = src.trip_date)
    WHEN NOT MATCHED THEN
        INSERT (trip_id, trip_date, auto_print_enabled, created_date)
        VALUES (v_trip_id, v_trip_date, 'N', SYSDATE);

    -- Retrieve the trip_config_id
    SELECT trip_config_id
    INTO   v_trip_config_id
    FROM   wms_trip_config
    WHERE  trip_id   = v_trip_id
      AND  trip_date = v_trip_date;

    -- Insert print job record
    INSERT INTO wms_print_jobs (
        trip_config_id,
        order_number,
        trip_id,
        trip_date,
        customer_name,
        account_number,
        download_status,
        print_status,
        overall_status,
        file_path,
        file_size_bytes,
        download_started,
        download_completed,
        created_date
    ) VALUES (
        v_trip_config_id,
        v_order_number,
        v_trip_id,
        v_trip_date,
        v_customer_name,
        v_account_number,
        v_download_status,
        v_print_status,
        v_overall_status,
        v_file_path,
        v_file_size,
        SYSDATE,
        SYSDATE,
        SYSDATE
    );

    COMMIT;

    HTP.p('{"status":"ok","orderNumber":"' || v_order_number || '","tripId":"' || v_trip_id || '"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.p('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;


-- ============================================================
-- TEST QUERY
-- ============================================================
-- Check recently inserted print jobs from agents module
SELECT pj.print_job_id, pj.order_number, pj.trip_id, pj.trip_date,
       pj.download_status, pj.print_status, pj.overall_status,
       pj.file_path, pj.file_size_bytes, pj.created_date
FROM   wms_print_jobs pj
ORDER  BY pj.created_date DESC
FETCH FIRST 20 ROWS ONLY;

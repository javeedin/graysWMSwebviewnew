-- ============================================================================
-- MONITOR PRINTING DETAILS - Order-Level Tracking
-- ============================================================================
-- This file extends monitor printing to track individual orders within trips
--
-- Endpoints:
-- 1. POST /monitor-printing/enable (UPDATED) - Now saves trip + order details
-- 2. GET /monitor-printing/orders - Get orders for a specific trip
-- 3. POST /monitor-printing/update-order-status - Update status of single order
-- ============================================================================

-- ============================================================================
-- STEP 1: Create order details table
-- ============================================================================

CREATE TABLE wms_monitor_printing_details (
    detail_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    monitor_id NUMBER NOT NULL,
    order_number VARCHAR2(100) NOT NULL,
    customer_name VARCHAR2(200),
    account_number VARCHAR2(100),
    order_date DATE,
    pdf_status VARCHAR2(50) DEFAULT 'PENDING',
    print_status VARCHAR2(50) DEFAULT 'PENDING',
    pdf_path VARCHAR2(500),
    download_attempts NUMBER DEFAULT 0,
    print_attempts NUMBER DEFAULT 0,
    last_error VARCHAR2(1000),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_monitor_details FOREIGN KEY (monitor_id)
        REFERENCES wms_monitor_printing(monitor_id) ON DELETE CASCADE
);

-- Indexes for faster queries
CREATE INDEX idx_details_monitor ON wms_monitor_printing_details(monitor_id);
CREATE INDEX idx_details_order ON wms_monitor_printing_details(order_number);
CREATE INDEX idx_details_pdf_status ON wms_monitor_printing_details(pdf_status);
CREATE INDEX idx_details_print_status ON wms_monitor_printing_details(print_status);

-- ============================================================================
-- STEP 2: Create/Update stored procedures
-- ============================================================================

-- Updated procedure to enable monitor printing with order details
CREATE OR REPLACE PROCEDURE wms_enable_monitor_printing_v2 (
    p_trip_id IN VARCHAR2,
    p_trip_date IN VARCHAR2,
    p_order_count IN NUMBER,
    p_printer_config_id IN NUMBER,
    p_printer_name IN VARCHAR2,
    p_orders_json IN CLOB,  -- JSON array of orders
    p_result OUT VARCHAR2,
    p_monitor_id OUT NUMBER
) AS
    v_trip_date_parsed DATE;
    v_existing_count NUMBER;
    v_monitor_id NUMBER;
    v_orders_array JSON_ARRAY_T;
    v_order JSON_OBJECT_T;
    v_order_number VARCHAR2(100);
    v_customer_name VARCHAR2(200);
    v_account_number VARCHAR2(100);
    v_order_date DATE;
BEGIN
    -- Parse trip date
    BEGIN
        v_trip_date_parsed := TO_DATE(p_trip_date, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            p_result := 'ERROR: Invalid date format. Use YYYY-MM-DD';
            RETURN;
    END;

    -- Check if already exists
    SELECT COUNT(*), MAX(monitor_id)
    INTO v_existing_count, v_monitor_id
    FROM wms_monitor_printing
    WHERE trip_id = p_trip_id
      AND trip_date = v_trip_date_parsed;

    IF v_existing_count > 0 THEN
        -- Update existing trip
        UPDATE wms_monitor_printing
        SET order_count = p_order_count,
            printer_config_id = p_printer_config_id,
            printer_name = p_printer_name,
            status = 'PENDING_DOWNLOAD',
            last_updated = CURRENT_TIMESTAMP
        WHERE monitor_id = v_monitor_id;

        -- Delete old order details
        DELETE FROM wms_monitor_printing_details
        WHERE monitor_id = v_monitor_id;
    ELSE
        -- Insert new trip
        INSERT INTO wms_monitor_printing (
            trip_id, trip_date, order_count, printer_config_id,
            printer_name, status, enabled_by
        ) VALUES (
            p_trip_id, v_trip_date_parsed, p_order_count, p_printer_config_id,
            p_printer_name, 'PENDING_DOWNLOAD', USER
        ) RETURNING monitor_id INTO v_monitor_id;
    END IF;

    -- Parse and insert order details
    IF p_orders_json IS NOT NULL AND LENGTH(p_orders_json) > 0 THEN
        BEGIN
            v_orders_array := JSON_ARRAY_T.parse(p_orders_json);

            FOR i IN 0 .. v_orders_array.get_size - 1 LOOP
                v_order := JSON_OBJECT_T(v_orders_array.get(i));

                v_order_number := v_order.get_string('orderNumber');
                v_customer_name := v_order.get_string('customerName');
                v_account_number := v_order.get_string('accountNumber');

                -- Parse order date
                BEGIN
                    v_order_date := TO_DATE(v_order.get_string('orderDate'), 'YYYY-MM-DD');
                EXCEPTION
                    WHEN OTHERS THEN
                        v_order_date := v_trip_date_parsed;
                END;

                INSERT INTO wms_monitor_printing_details (
                    monitor_id, order_number, customer_name, account_number,
                    order_date, pdf_status, print_status
                ) VALUES (
                    v_monitor_id, v_order_number, v_customer_name, v_account_number,
                    v_order_date, 'PENDING', 'PENDING'
                );
            END LOOP;
        EXCEPTION
            WHEN OTHERS THEN
                ROLLBACK;
                p_result := 'ERROR: Failed to parse orders: ' || SQLERRM;
                RETURN;
        END;
    END IF;

    COMMIT;
    p_result := 'SUCCESS';
    p_monitor_id := v_monitor_id;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_enable_monitor_printing_v2;
/

-- Procedure to get order details for a trip
CREATE OR REPLACE PROCEDURE wms_get_order_details (
    p_monitor_id IN NUMBER,
    p_cursor OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        detail_id,
        order_number,
        customer_name,
        account_number,
        TO_CHAR(order_date, 'YYYY-MM-DD') AS order_date,
        pdf_status,
        print_status,
        pdf_path,
        download_attempts,
        print_attempts,
        last_error,
        TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI:SS') AS created_date,
        TO_CHAR(last_updated, 'YYYY-MM-DD HH24:MI:SS') AS last_updated
    FROM wms_monitor_printing_details
    WHERE monitor_id = p_monitor_id
    ORDER BY order_number;
END wms_get_order_details;
/

-- Procedure to update order status
CREATE OR REPLACE PROCEDURE wms_update_order_status (
    p_detail_id IN NUMBER,
    p_pdf_status IN VARCHAR2,
    p_print_status IN VARCHAR2,
    p_pdf_path IN VARCHAR2,
    p_error_message IN VARCHAR2,
    p_result OUT VARCHAR2
) AS
    v_monitor_id NUMBER;
    v_download_count NUMBER := 0;
    v_pending_count NUMBER := 0;
    v_trip_status VARCHAR2(50);
BEGIN
    -- Update order detail
    UPDATE wms_monitor_printing_details
    SET pdf_status = NVL(p_pdf_status, pdf_status),
        print_status = NVL(p_print_status, print_status),
        pdf_path = NVL(p_pdf_path, pdf_path),
        download_attempts = CASE WHEN p_pdf_status IS NOT NULL THEN download_attempts + 1 ELSE download_attempts END,
        print_attempts = CASE WHEN p_print_status IS NOT NULL THEN print_attempts + 1 ELSE print_attempts END,
        last_error = p_error_message,
        last_updated = CURRENT_TIMESTAMP
    WHERE detail_id = p_detail_id
    RETURNING monitor_id INTO v_monitor_id;

    -- Update trip-level status based on order statuses
    SELECT
        COUNT(CASE WHEN pdf_status = 'DOWNLOADED' THEN 1 END),
        COUNT(CASE WHEN pdf_status = 'PENDING' OR print_status = 'PENDING' THEN 1 END)
    INTO v_download_count, v_pending_count
    FROM wms_monitor_printing_details
    WHERE monitor_id = v_monitor_id;

    IF v_pending_count = 0 THEN
        v_trip_status := 'COMPLETED';
    ELSIF v_download_count > 0 THEN
        v_trip_status := 'IN_PROGRESS';
    ELSE
        v_trip_status := 'PENDING_DOWNLOAD';
    END IF;

    UPDATE wms_monitor_printing
    SET status = v_trip_status,
        last_updated = CURRENT_TIMESTAMP
    WHERE monitor_id = v_monitor_id;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_update_order_status;
/

-- ============================================================================
-- STEP 3: APEX REST API Endpoints
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENDPOINT 1: POST /monitor-printing/enable (UPDATED)
-- ----------------------------------------------------------------------------
-- Method: POST
-- Source Type: PL/SQL
-- Source:

DECLARE
    v_trip_id VARCHAR2(100);
    v_trip_date VARCHAR2(20);
    v_order_count NUMBER;
    v_printer_config_id NUMBER;
    v_printer_name VARCHAR2(200);
    v_orders_json CLOB;
    v_result VARCHAR2(500);
    v_monitor_id NUMBER;
    l_body BLOB;
    v_body CLOB;
BEGIN
    -- Read request body (ORDS 20.x+)
    l_body := :body;
    v_body := UTL_RAW.CAST_TO_VARCHAR2(DBMS_LOB.SUBSTR(l_body, 32000, 1));

    -- Parse JSON body
    APEX_JSON.parse(v_body);

    v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
    v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');
    v_order_count := APEX_JSON.get_number(p_path => 'orderCount');
    v_printer_config_id := APEX_JSON.get_number(p_path => 'printerConfigId');
    v_printer_name := APEX_JSON.get_varchar2(p_path => 'printerName');

    -- Get orders array as JSON string
    v_orders_json := APEX_JSON.get_clob(p_path => 'orders');

    -- Call updated procedure
    wms_enable_monitor_printing_v2(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_order_count => v_order_count,
        p_printer_config_id => v_printer_config_id,
        p_printer_name => v_printer_name,
        p_orders_json => v_orders_json,
        p_result => v_result,
        p_monitor_id => v_monitor_id
    );

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Auto-print enabled successfully","monitorId":' || v_monitor_id || '}');
    ELSE
        HTP.p('{"success":false,"error":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

-- ----------------------------------------------------------------------------
-- ENDPOINT 2: GET /monitor-printing/orders
-- ----------------------------------------------------------------------------
-- Method: GET
-- Source Type: PL/SQL
-- Parameters: monitorId (Query String)
-- Source:

DECLARE
    v_cursor SYS_REFCURSOR;
    v_monitor_id NUMBER;

    v_detail_id NUMBER;
    v_order_number VARCHAR2(100);
    v_customer_name VARCHAR2(200);
    v_account_number VARCHAR2(100);
    v_order_date VARCHAR2(20);
    v_pdf_status VARCHAR2(50);
    v_print_status VARCHAR2(50);
    v_pdf_path VARCHAR2(500);
    v_download_attempts NUMBER;
    v_print_attempts NUMBER;
    v_last_error VARCHAR2(1000);
    v_created_date VARCHAR2(30);
    v_last_updated VARCHAR2(30);

    v_first BOOLEAN := TRUE;
BEGIN
    -- Get query parameter
    v_monitor_id := :monitorId;

    -- Call procedure
    wms_get_order_details(
        p_monitor_id => v_monitor_id,
        p_cursor => v_cursor
    );

    -- Build JSON response
    HTP.p('{"items":[');

    LOOP
        FETCH v_cursor INTO
            v_detail_id, v_order_number, v_customer_name, v_account_number,
            v_order_date, v_pdf_status, v_print_status, v_pdf_path,
            v_download_attempts, v_print_attempts, v_last_error,
            v_created_date, v_last_updated;

        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN HTP.p(','); END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"detailId":' || v_detail_id || ',');
        HTP.p('"orderNumber":"' || REPLACE(v_order_number, '"', '\"') || '",');
        HTP.p('"customerName":"' || REPLACE(v_customer_name, '"', '\"') || '",');
        HTP.p('"accountNumber":"' || REPLACE(v_account_number, '"', '\"') || '",');
        HTP.p('"orderDate":"' || v_order_date || '",');
        HTP.p('"pdfStatus":"' || v_pdf_status || '",');
        HTP.p('"printStatus":"' || v_print_status || '",');
        HTP.p('"pdfPath":"' || COALESCE(REPLACE(v_pdf_path, '"', '\"'), '') || '",');
        HTP.p('"downloadAttempts":' || v_download_attempts || ',');
        HTP.p('"printAttempts":' || v_print_attempts || ',');
        HTP.p('"lastError":"' || COALESCE(REPLACE(v_last_error, '"', '\"'), '') || '",');
        HTP.p('"createdDate":"' || v_created_date || '",');
        HTP.p('"lastUpdated":"' || v_last_updated || '"');
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;

-- ----------------------------------------------------------------------------
-- ENDPOINT 3: POST /monitor-printing/update-order-status
-- ----------------------------------------------------------------------------
-- Method: POST
-- Source Type: PL/SQL
-- Source:

DECLARE
    v_detail_id NUMBER;
    v_pdf_status VARCHAR2(50);
    v_print_status VARCHAR2(50);
    v_pdf_path VARCHAR2(500);
    v_error_message VARCHAR2(1000);
    v_result VARCHAR2(500);
    l_body BLOB;
    v_body CLOB;
BEGIN
    -- Read request body (ORDS 20.x+)
    l_body := :body;
    v_body := UTL_RAW.CAST_TO_VARCHAR2(DBMS_LOB.SUBSTR(l_body, 32000, 1));

    -- Parse JSON body
    APEX_JSON.parse(v_body);

    v_detail_id := APEX_JSON.get_number(p_path => 'detailId');
    v_pdf_status := APEX_JSON.get_varchar2(p_path => 'pdfStatus');
    v_print_status := APEX_JSON.get_varchar2(p_path => 'printStatus');
    v_pdf_path := APEX_JSON.get_varchar2(p_path => 'pdfPath');
    v_error_message := APEX_JSON.get_varchar2(p_path => 'errorMessage');

    -- Call procedure
    wms_update_order_status(
        p_detail_id => v_detail_id,
        p_pdf_status => v_pdf_status,
        p_print_status => v_print_status,
        p_pdf_path => v_pdf_path,
        p_error_message => v_error_message,
        p_result => v_result
    );

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Order status updated successfully"}');
    ELSE
        HTP.p('{"success":false,"error":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

-- ============================================================================
-- END OF FILE
-- ============================================================================

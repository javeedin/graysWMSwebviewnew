-- ============================================================================
-- WMS SET DATA - Web Service for Updating Store Transaction Lots
-- ============================================================================
-- Created: 2025-11-24
-- Purpose: Handle single and multiple record updates to WMS_STORE_TRANSACTION_LOTS
-- ============================================================================

-- ============================================================================
-- STEP 1: Create the stored procedure to handle multiple record updates
-- ============================================================================

CREATE OR REPLACE PROCEDURE wms_set_store_transaction_data (
    p_records_json      IN  CLOB,
    p_result            OUT VARCHAR2,
    p_success_count     OUT NUMBER,
    p_error_count       OUT NUMBER,
    p_error_details     OUT VARCHAR2
) AS
    v_record_count      NUMBER := 0;
    v_success_count     NUMBER := 0;
    v_error_count       NUMBER := 0;
    v_error_details     VARCHAR2(4000) := '';

    -- Variables for parsing JSON
    v_lid               NUMBER;
    v_lot_number        VARCHAR2(200);
    v_picked_qty        NUMBER;
    v_ship_confirm_st   VARCHAR2(50);
    v_lot_exp_date      DATE;
    v_picked_status     VARCHAR2(50);

    v_rows_updated      NUMBER;

BEGIN
    -- Parse the JSON array
    APEX_JSON.parse(p_records_json);

    -- Get the count of records in the array
    v_record_count := APEX_JSON.get_count(p_path => '.');

    -- Loop through each record in the JSON array
    FOR i IN 1..v_record_count LOOP
        BEGIN
            -- Extract values from JSON (using NVL to handle nulls)
            v_lid := APEX_JSON.get_number(p_path => '[%d].lid', p0 => i);
            v_lot_number := APEX_JSON.get_varchar2(p_path => '[%d].lot_number', p0 => i);
            v_picked_qty := APEX_JSON.get_number(p_path => '[%d].picked_qty', p0 => i);
            v_ship_confirm_st := APEX_JSON.get_varchar2(p_path => '[%d].ship_confirm_status', p0 => i);
            v_picked_status := APEX_JSON.get_varchar2(p_path => '[%d].pick_confirm_status', p0 => i);

            -- Handle date conversion
            BEGIN
                v_lot_exp_date := TO_DATE(
                    APEX_JSON.get_varchar2(p_path => '[%d].lot_expiration_date', p0 => i),
                    'YYYY-MM-DD'
                );
            EXCEPTION
                WHEN OTHERS THEN
                    v_lot_exp_date := NULL;
            END;

            -- Update the record using NVL to only update fields that are provided
            UPDATE WMS_STORE_TRANSACTION_LOTS
            SET LOT_NUMBER = NVL(v_lot_number, LOT_NUMBER),
                PICKED_QTY = NVL(v_picked_qty, PICKED_QTY),
                SHIP_CONFIRM_ST = NVL(v_ship_confirm_st, SHIP_CONFIRM_ST),
                LOT_EXPIRATION_DATE = NVL(v_lot_exp_date, LOT_EXPIRATION_DATE),
                PICKED_STATUS = NVL(v_picked_status, PICKED_STATUS)
            WHERE LID = v_lid;

            v_rows_updated := SQL%ROWCOUNT;

            IF v_rows_updated > 0 THEN
                v_success_count := v_success_count + 1;
            ELSE
                v_error_count := v_error_count + 1;
                v_error_details := v_error_details || 'LID ' || v_lid || ': No record found; ';
            END IF;

        EXCEPTION
            WHEN OTHERS THEN
                v_error_count := v_error_count + 1;
                v_error_details := v_error_details || 'LID ' || NVL(TO_CHAR(v_lid), 'NULL') || ': ' || SQLERRM || '; ';
        END;
    END LOOP;

    -- Commit all changes
    COMMIT;

    -- Set output parameters
    p_success_count := v_success_count;
    p_error_count := v_error_count;
    p_error_details := SUBSTR(v_error_details, 1, 4000);

    -- Determine result
    IF v_error_count = 0 THEN
        p_result := 'SUCCESS';
    ELSIF v_success_count > 0 THEN
        p_result := 'PARTIAL_SUCCESS';
    ELSE
        p_result := 'FAILED';
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR';
        p_success_count := 0;
        p_error_count := v_record_count;
        p_error_details := 'Procedure error: ' || SQLERRM;
END wms_set_store_transaction_data;
/


-- ============================================================================
-- STEP 2: Create APEX REST API Endpoint
-- ============================================================================
/*
═══════════════════════════════════════════════════════════════
ENDPOINT: POST /wms/set-data
═══════════════════════════════════════════════════════════════
URI Template:   /wms/set-data
HTTP Method:    POST
Source Type:    PL/SQL
Content Type:   application/json

Expected JSON Input Format:
{
  "records": [
    {
      "lid": 123,
      "lot_number": "LOT001",
      "picked_qty": 100,
      "ship_confirm_status": "Y",
      "pick_confirm_status": "Y",
      "lot_expiration_date": "2025-12-31"
    },
    {
      "lid": 124,
      "lot_number": "LOT002",
      "picked_qty": 50,
      "ship_confirm_status": "N",
      "pick_confirm_status": "Y",
      "lot_expiration_date": "2025-11-30"
    }
  ]
}

Source Code for APEX Handler:
*/

DECLARE
    v_body              CLOB;
    v_records_json      CLOB;
    v_result            VARCHAR2(100);
    v_success_count     NUMBER;
    v_error_count       NUMBER;
    v_error_details     VARCHAR2(4000);
BEGIN
    -- Get request body
    v_body := :body_text;

    -- Parse JSON
    APEX_JSON.parse(v_body);

    -- Extract the records array as JSON string
    v_records_json := APEX_JSON.get_clob('records');

    -- Call the procedure
    wms_set_store_transaction_data(
        p_records_json => v_records_json,
        p_result => v_result,
        p_success_count => v_success_count,
        p_error_count => v_error_count,
        p_error_details => v_error_details
    );

    -- Set HTTP status code
    :status_code := CASE
        WHEN v_result = 'SUCCESS' THEN 200
        WHEN v_result = 'PARTIAL_SUCCESS' THEN 206
        ELSE 500
    END;

    -- Return JSON response
    HTP.p('{');
    HTP.p('"success": ' || CASE WHEN v_result IN ('SUCCESS', 'PARTIAL_SUCCESS') THEN 'true' ELSE 'false' END || ',');
    HTP.p('"status": "' || v_result || '",');
    HTP.p('"message": "Updated ' || v_success_count || ' record(s) successfully",');
    HTP.p('"successCount": ' || v_success_count || ',');
    HTP.p('"errorCount": ' || v_error_count || ',');
    HTP.p('"totalRecords": ' || (v_success_count + v_error_count) || ',');
    HTP.p('"errorDetails": "' || REPLACE(REPLACE(v_error_details, '"', '\"'), CHR(10), ' ') || '"');
    HTP.p('}');

END;


-- ============================================================================
-- STEP 3: Alternative single record endpoint (if needed)
-- ============================================================================
/*
═══════════════════════════════════════════════════════════════
ENDPOINT: POST /wms/set-data/single
═══════════════════════════════════════════════════════════════
For updating a single record without array wrapper

Expected JSON Input:
{
  "lid": 123,
  "lot_number": "LOT001",
  "picked_qty": 100,
  "ship_confirm_status": "Y",
  "pick_confirm_status": "Y",
  "lot_expiration_date": "2025-12-31"
}

Source Code:
*/

DECLARE
    v_body              CLOB;
    v_lid               NUMBER;
    v_lot_number        VARCHAR2(200);
    v_picked_qty        NUMBER;
    v_ship_confirm_st   VARCHAR2(50);
    v_picked_status     VARCHAR2(50);
    v_lot_exp_date      DATE;
    v_rows_updated      NUMBER;
BEGIN
    v_body := :body_text;

    -- Parse JSON
    APEX_JSON.parse(v_body);

    -- Extract values
    v_lid := APEX_JSON.get_number('lid');
    v_lot_number := APEX_JSON.get_varchar2('lot_number');
    v_picked_qty := APEX_JSON.get_number('picked_qty');
    v_ship_confirm_st := APEX_JSON.get_varchar2('ship_confirm_status');
    v_picked_status := APEX_JSON.get_varchar2('pick_confirm_status');

    -- Handle date
    BEGIN
        v_lot_exp_date := TO_DATE(APEX_JSON.get_varchar2('lot_expiration_date'), 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_lot_exp_date := NULL;
    END;

    -- Update the record
    UPDATE WMS_STORE_TRANSACTION_LOTS
    SET LOT_NUMBER = NVL(v_lot_number, LOT_NUMBER),
        PICKED_QTY = NVL(v_picked_qty, PICKED_QTY),
        SHIP_CONFIRM_ST = NVL(v_ship_confirm_st, SHIP_CONFIRM_ST),
        LOT_EXPIRATION_DATE = NVL(v_lot_exp_date, LOT_EXPIRATION_DATE),
        PICKED_STATUS = NVL(v_picked_status, PICKED_STATUS)
    WHERE LID = v_lid;

    v_rows_updated := SQL%ROWCOUNT;

    IF v_rows_updated > 0 THEN
        COMMIT;
        :status_code := 200;
        HTP.p('{"success": true, "message": "Record updated successfully", "lid": ' || v_lid || '}');
    ELSE
        ROLLBACK;
        :status_code := 404;
        HTP.p('{"success": false, "message": "No record found with LID: ' || v_lid || '"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.p('{"success": false, "message": "Error: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;


-- ============================================================================
-- TESTING EXAMPLES
-- ============================================================================
/*
Test with cURL or Postman:

1. UPDATE MULTIPLE RECORDS:
---------------------------
POST /ords/workspace/wms/v1/wms/set-data
Content-Type: application/json

{
  "records": [
    {
      "lid": 123,
      "lot_number": "LOT001",
      "picked_qty": 100,
      "ship_confirm_status": "Y",
      "pick_confirm_status": "Y",
      "lot_expiration_date": "2025-12-31"
    },
    {
      "lid": 124,
      "lot_number": "LOT002",
      "picked_qty": 50,
      "ship_confirm_status": "N",
      "pick_confirm_status": "Y",
      "lot_expiration_date": "2025-11-30"
    }
  ]
}

Expected Response:
{
  "success": true,
  "status": "SUCCESS",
  "message": "Updated 2 record(s) successfully",
  "successCount": 2,
  "errorCount": 0,
  "totalRecords": 2,
  "errorDetails": ""
}


2. UPDATE SINGLE RECORD:
------------------------
POST /ords/workspace/wms/v1/wms/set-data/single
Content-Type: application/json

{
  "lid": 123,
  "lot_number": "LOT001-UPDATED",
  "picked_qty": 150,
  "ship_confirm_status": "Y",
  "pick_confirm_status": "Y",
  "lot_expiration_date": "2025-12-31"
}

Expected Response:
{
  "success": true,
  "message": "Record updated successfully",
  "lid": 123
}


3. PARTIAL UPDATE (only some fields):
--------------------------------------
POST /ords/workspace/wms/v1/wms/set-data
Content-Type: application/json

{
  "records": [
    {
      "lid": 123,
      "lot_number": "LOT001-NEW"
    }
  ]
}

Note: Only lot_number will be updated; other fields remain unchanged due to NVL logic


4. cURL EXAMPLES:
-----------------
# Multiple records
curl -X POST https://your-apex.com/ords/workspace/wms/v1/wms/set-data \
  -H "Content-Type: application/json" \
  -d '{
    "records": [
      {
        "lid": 123,
        "lot_number": "LOT001",
        "picked_qty": 100,
        "ship_confirm_status": "Y",
        "pick_confirm_status": "Y",
        "lot_expiration_date": "2025-12-31"
      }
    ]
  }'

# Single record
curl -X POST https://your-apex.com/ords/workspace/wms/v1/wms/set-data/single \
  -H "Content-Type: application/json" \
  -d '{
    "lid": 123,
    "lot_number": "LOT001",
    "picked_qty": 100
  }'
*/


-- ============================================================================
-- SETUP INSTRUCTIONS FOR APEX
-- ============================================================================
/*
1. Run this SQL file in SQL Developer or SQL*Plus to create the stored procedure

2. In Oracle APEX (SQL Workshop > RESTful Services):

   a) Navigate to your existing wms_api module (or create one with base path /wms/v1/)

   b) Create Resource Template: /wms/set-data
      - URI Template: /wms/set-data

   c) Create Handler for Multiple Records:
      - Method: POST
      - Source Type: PL/SQL
      - Source: Copy the code from "ENDPOINT: POST /wms/set-data" section above (lines 152-196)
      - IMPORTANT: Copy ONLY the DECLARE...END; block WITHOUT any "/" character at the end

   d) Create Resource Template: /wms/set-data/single (optional)
      - URI Template: /wms/set-data/single

   e) Create Handler for Single Record:
      - Method: POST
      - Source Type: PL/SQL
      - Source: Copy the code from "ENDPOINT: POST /wms/set-data/single" section above (lines 222-277)
      - IMPORTANT: Copy ONLY the DECLARE...END; block WITHOUT any "/" character at the end

3. Test the endpoint using the examples provided above

4. Your final URL will be:
   - Multiple: https://[apex-host]/ords/[workspace]/wms/v1/wms/set-data
   - Single: https://[apex-host]/ords/[workspace]/wms/v1/wms/set-data/single

CRITICAL NOTE:
--------------
When copying PL/SQL code into APEX REST handler source, do NOT include the "/" (slash)
character that appears after END; in SQL*Plus scripts. The "/" is only used in SQL*Plus
for executing blocks, but causes ORA-06550 errors in APEX REST handlers.
*/

-- ============================================================================
-- NOTES
-- ============================================================================
/*
Key Features:
-------------
1. Handles multiple records in a single API call
2. Uses NVL to only update fields that are provided (null values don't overwrite existing data)
3. Returns detailed success/error counts
4. Handles date conversion gracefully
5. Supports partial updates (you can send only the fields you want to update)
6. Transaction safety with COMMIT/ROLLBACK
7. Detailed error reporting per record

Response Codes:
---------------
- 200: All records updated successfully
- 206: Partial success (some records failed)
- 404: Record not found (single record endpoint)
- 500: Error occurred

Fields Updated:
---------------
- lot_number (LOT_NUMBER)
- picked_qty (PICKED_QTY)
- ship_confirm_status (SHIP_CONFIRM_ST)
- lot_expiration_date (LOT_EXPIRATION_DATE)
- pick_confirm_status (PICKED_STATUS)

Primary Key:
------------
- LID (must be provided for each record)
*/

-- ============================================================================
-- END OF FILE
-- ============================================================================

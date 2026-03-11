================================================================================
PRINTER MANAGEMENT ENDPOINTS
================================================================================

These endpoints support full CRUD operations for printer management:
- GET all printers
- POST set active printer
- POST delete printer

================================================================================


================================================================================
ENDPOINT 1: GET /printers/all
================================================================================
Purpose: Get all printer configurations for management page
URI Template: printers/all
Method: GET
Source Type: PL/SQL

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_cursor SYS_REFCURSOR;

    -- Cursor variables
    v_config_id NUMBER;
    v_printer_name VARCHAR2(200);
    v_paper_size VARCHAR2(50);
    v_orientation VARCHAR2(20);
    v_fusion_instance VARCHAR2(20);
    v_fusion_username VARCHAR2(100);
    v_fusion_password VARCHAR2(200);
    v_auto_download VARCHAR2(1);
    v_auto_print VARCHAR2(1);
    v_is_active VARCHAR2(1);
    v_created_date DATE;
    v_modified_date DATE;
    v_created_by VARCHAR2(100);
    v_modified_by VARCHAR2(100);

    v_first BOOLEAN := TRUE;
BEGIN
    -- Call the procedure
    wms_get_all_printers(p_cursor => v_cursor);

    -- Build JSON output
    HTP.p('{"items":[');

    LOOP
        FETCH v_cursor INTO
            v_config_id, v_printer_name, v_paper_size, v_orientation,
            v_fusion_instance, v_fusion_username, v_fusion_password,
            v_auto_download, v_auto_print, v_is_active,
            v_created_date, v_modified_date, v_created_by, v_modified_by;
        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN
            HTP.p(',');
        END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"configId":' || v_config_id || ',');
        HTP.p('"printerName":"' || REPLACE(NVL(v_printer_name, ''), '"', '\"') || '",');
        HTP.p('"paperSize":"' || REPLACE(NVL(v_paper_size, ''), '"', '\"') || '",');
        HTP.p('"orientation":"' || REPLACE(NVL(v_orientation, ''), '"', '\"') || '",');
        HTP.p('"fusionInstance":"' || REPLACE(NVL(v_fusion_instance, ''), '"', '\"') || '",');
        HTP.p('"fusionUsername":"' || REPLACE(NVL(v_fusion_username, ''), '"', '\"') || '",');
        HTP.p('"fusionPassword":"' || REPLACE(NVL(v_fusion_password, ''), '"', '\"') || '",');
        HTP.p('"autoDownload":"' || NVL(v_auto_download, 'N') || '",');
        HTP.p('"autoPrint":"' || NVL(v_auto_print, 'N') || '",');
        HTP.p('"isActive":"' || NVL(v_is_active, 'N') || '",');
        HTP.p('"createdDate":"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",');
        HTP.p('"modifiedDate":' ||
            CASE WHEN v_modified_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_modified_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"createdBy":' ||
            CASE WHEN v_created_by IS NULL THEN 'null'
                 ELSE '"' || REPLACE(v_created_by, '"', '\"') || '"'
            END || ',');
        HTP.p('"modifiedBy":' ||
            CASE WHEN v_modified_by IS NULL THEN 'null'
                 ELSE '"' || REPLACE(v_modified_by, '"', '\"') || '"'
            END);
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;


Test URL:
GET /printers/all

Expected Response:
{
  "items": [
    {
      "configId": 1,
      "printerName": "Microsoft Print to PDF",
      "paperSize": "A4",
      "orientation": "Portrait",
      "fusionInstance": "TEST",
      "fusionUsername": "user1",
      "fusionPassword": "pass123",
      "autoDownload": "Y",
      "autoPrint": "Y",
      "isActive": "Y",
      "createdDate": "2025-11-05T10:30:00Z",
      "modifiedDate": null,
      "createdBy": "ADMIN",
      "modifiedBy": null
    }
  ]
}


================================================================================
ENDPOINT 2: POST /printers/set-active
================================================================================
Purpose: Set a specific printer as active (deactivates others)
URI Template: printers/set-active
Method: POST
Source Type: PL/SQL

Request Body Example:
{
  "configId": 2
}

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_config_id NUMBER;
    v_result VARCHAR2(200);
BEGIN
    -- Parse JSON input
    SELECT config_id
    INTO v_config_id
    FROM JSON_TABLE(
        :body_text, '$'
        COLUMNS (
            config_id NUMBER PATH '$.configId'
        )
    );

    -- Call the procedure
    wms_set_active_printer(
        p_config_id => v_config_id,
        p_result => v_result
    );

    -- Return JSON response
    IF v_result = 'SUCCESS' THEN
        :status_code := 200;
        HTP.p('{');
        HTP.p('"status":"success",');
        HTP.p('"message":"Printer set as active successfully"');
        HTP.p('}');
    ELSE
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(v_result, '"', '\"') || '"');
        HTP.p('}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(SQLERRM, '"', '\"') || '"');
        HTP.p('}');
END;


================================================================================
ENDPOINT 3: POST /printers/delete
================================================================================
Purpose: Delete a printer configuration
URI Template: printers/delete
Method: POST
Source Type: PL/SQL

Request Body Example:
{
  "configId": 3
}

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_config_id NUMBER;
    v_result VARCHAR2(200);
BEGIN
    -- Parse JSON input
    SELECT config_id
    INTO v_config_id
    FROM JSON_TABLE(
        :body_text, '$'
        COLUMNS (
            config_id NUMBER PATH '$.configId'
        )
    );

    -- Call the procedure
    wms_delete_printer(
        p_config_id => v_config_id,
        p_result => v_result
    );

    -- Return JSON response
    IF v_result = 'SUCCESS' THEN
        :status_code := 200;
        HTP.p('{');
        HTP.p('"status":"success",');
        HTP.p('"message":"Printer deleted successfully"');
        HTP.p('}');
    ELSE
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(v_result, '"', '\"') || '"');
        HTP.p('}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(SQLERRM, '"', '\"') || '"');
        HTP.p('}');
END;


================================================================================
SETUP INSTRUCTIONS
================================================================================

1. First, run the procedures SQL file:
   - Execute: 06_additional_printer_procedures.sql

2. Then create each endpoint in APEX:

   For GET /printers/all:
   - URI Template: printers/all
   - Method: GET
   - No parameters needed

   For POST /printers/set-active:
   - URI Template: printers/set-active
   - Method: POST
   - No parameters needed (uses :body_text)

   For POST /printers/delete:
   - URI Template: printers/delete
   - Method: POST
   - No parameters needed (uses :body_text)


================================================================================
API SUMMARY
================================================================================

Printer Management APIs:
✅ GET  /printers/all         - Get all printers
✅ GET  /config/printer        - Get active printer only
✅ POST /config/printer        - Add new printer (already exists)
✅ POST /printers/set-active   - Set printer as active
✅ POST /printers/delete       - Delete printer


================================================================================
TESTING IN POSTMAN
================================================================================

1. GET all printers:
   GET https://your-apex-url/ords/workspace/wms/v1/printers/all

2. Set printer as active:
   POST https://your-apex-url/ords/workspace/wms/v1/printers/set-active
   Body: {"configId": 2}

3. Delete printer:
   POST https://your-apex-url/ords/workspace/wms/v1/printers/delete
   Body: {"configId": 3}

4. Add new printer:
   POST https://your-apex-url/ords/workspace/wms/v1/config/printer
   Body: {
     "printerName": "HP LaserJet",
     "paperSize": "A4",
     "orientation": "Portrait",
     "fusionInstance": "PROD",
     "fusionUsername": "user",
     "fusionPassword": "pass",
     "autoDownload": "Y",
     "autoPrint": "Y"
   }


================================================================================
NOTES
================================================================================

1. Only ONE printer can be active at a time
2. Cannot delete the active printer
3. When adding a new printer, it automatically becomes active
4. All printers are returned sorted with active printer first
5. Passwords are stored in plain text (consider encryption for production)

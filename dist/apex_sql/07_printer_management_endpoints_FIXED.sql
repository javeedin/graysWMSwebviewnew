================================================================================
PRINTER MANAGEMENT ENDPOINTS - FIXED VERSION
================================================================================

IMPORTANT: This version uses JSON_OBJECT which automatically handles all
JSON escaping (quotes, backslashes, special characters, etc.)

Replace the existing endpoint handler with this fixed version.

================================================================================


================================================================================
ENDPOINT 1: GET /printers/all (FIXED VERSION)
================================================================================
Purpose: Get all printer configurations for management page
URI Template: printers/all
Method: GET
Source Type: PL/SQL

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_cursor SYS_REFCURSOR;
    v_json_array CLOB := '[';
    v_first BOOLEAN := TRUE;

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
BEGIN
    -- Call the procedure
    wms_get_all_printers(p_cursor => v_cursor);

    LOOP
        FETCH v_cursor INTO
            v_config_id, v_printer_name, v_paper_size, v_orientation,
            v_fusion_instance, v_fusion_username, v_fusion_password,
            v_auto_download, v_auto_print, v_is_active,
            v_created_date, v_modified_date, v_created_by, v_modified_by;
        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN
            v_json_array := v_json_array || ',';
        END IF;
        v_first := FALSE;

        -- Use JSON_OBJECT for proper escaping
        v_json_array := v_json_array || JSON_OBJECT(
            'configId' VALUE v_config_id,
            'printerName' VALUE v_printer_name,
            'paperSize' VALUE v_paper_size,
            'orientation' VALUE v_orientation,
            'fusionInstance' VALUE v_fusion_instance,
            'fusionUsername' VALUE v_fusion_username,
            'fusionPassword' VALUE v_fusion_password,
            'autoDownload' VALUE NVL(v_auto_download, 'N'),
            'autoPrint' VALUE NVL(v_auto_print, 'N'),
            'isActive' VALUE NVL(v_is_active, 'N'),
            'createdDate' VALUE TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'modifiedDate' VALUE CASE WHEN v_modified_date IS NULL THEN NULL
                                     ELSE TO_CHAR(v_modified_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                 END,
            'createdBy' VALUE v_created_by,
            'modifiedBy' VALUE v_modified_by
            ABSENT ON NULL
        );
    END LOOP;

    CLOSE v_cursor;
    v_json_array := v_json_array || ']';

    -- Output the final JSON
    HTP.p('{"items":' || v_json_array || '}');

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.p('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

================================================================================
ALTERNATIVE: SIMPLER VERSION (If JSON_OBJECT doesn't work)
================================================================================

If your Oracle version doesn't support JSON_OBJECT, use this version with
proper backslash escaping:

DECLARE
    v_cursor SYS_REFCURSOR;
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

    -- Function to escape JSON strings properly
    FUNCTION escape_json(p_text VARCHAR2) RETURN VARCHAR2 IS
        v_escaped VARCHAR2(4000);
    BEGIN
        v_escaped := p_text;
        -- Escape backslashes FIRST (important!)
        v_escaped := REPLACE(v_escaped, '\', '\\');
        -- Then escape double quotes
        v_escaped := REPLACE(v_escaped, '"', '\"');
        -- Escape newlines
        v_escaped := REPLACE(v_escaped, CHR(10), '\n');
        v_escaped := REPLACE(v_escaped, CHR(13), '\r');
        -- Escape tabs
        v_escaped := REPLACE(v_escaped, CHR(9), '\t');
        RETURN v_escaped;
    END;
BEGIN
    wms_get_all_printers(p_cursor => v_cursor);

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
        HTP.p('"printerName":"' || escape_json(NVL(v_printer_name, '')) || '",');
        HTP.p('"paperSize":"' || escape_json(NVL(v_paper_size, '')) || '",');
        HTP.p('"orientation":"' || escape_json(NVL(v_orientation, '')) || '",');
        HTP.p('"fusionInstance":"' || escape_json(NVL(v_fusion_instance, '')) || '",');
        HTP.p('"fusionUsername":"' || escape_json(NVL(v_fusion_username, '')) || '",');
        HTP.p('"fusionPassword":"' || escape_json(NVL(v_fusion_password, '')) || '",');
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
                 ELSE '"' || escape_json(v_created_by) || '"'
            END || ',');
        HTP.p('"modifiedBy":' ||
            CASE WHEN v_modified_by IS NULL THEN 'null'
                 ELSE '"' || escape_json(v_modified_by) || '"'
            END);
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.p('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

================================================================================
SETUP INSTRUCTIONS
================================================================================

1. Go to APEX SQL Workshop
2. Open your existing REST endpoint: /printers/all
3. Replace the Handler Code with one of the versions above
4. Test the endpoint
5. The JSON will now be properly escaped

================================================================================
WHAT THIS FIXES
================================================================================

Before (BROKEN):
  "printerName":"C:\Printer"  ❌ Invalid JSON!
  "fusionUsername":"domain\user"  ❌ Invalid JSON!

After (FIXED):
  "printerName":"C:\\Printer"  ✅ Valid JSON!
  "fusionUsername":"domain\\user"  ✅ Valid JSON!

All special characters are now properly escaped:
  - Backslashes (\)
  - Double quotes (")
  - Newlines (\n)
  - Carriage returns (\r)
  - Tabs (\t)

================================================================================

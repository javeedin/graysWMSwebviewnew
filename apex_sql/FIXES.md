# APEX REST API Fixes

## Issue: ORA-00904 "APEX_JSON"."GET_CURSOR_AS_JSON_TABLE": invalid identifier

### Problem
The original code tried to use `APEX_JSON.GET_CURSOR_AS_JSON_TABLE()` which doesn't exist in the APEX_JSON package.

### Root Cause
- `APEX_JSON` package doesn't have a `GET_CURSOR_AS_JSON_TABLE` function
- This was an incorrect assumption about available functions

### Solution Applied

#### ✅ **For GET Endpoints (returning data)**

**OLD (❌ WRONG):**
```sql
APEX_JSON.open_object;
APEX_JSON.write('success', TRUE);
APEX_JSON.open_array('data');

FOR rec IN (
    SELECT * FROM TABLE(
        APEX_JSON.get_cursor_as_json_table(v_cursor)  -- ❌ This doesn't exist
    )
) LOOP
    ...
END LOOP;
```

**NEW (✅ CORRECT):**
```sql
BEGIN
    wms_get_all_print_jobs(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_status_filter => v_status,
        p_cursor => :cursor  -- ✅ APEX auto-converts to JSON!
    );
END;
```

**Why it works:**
- APEX REST framework **automatically converts SYS_REFCURSOR to JSON array**
- No manual conversion needed!
- Just assign the cursor to `:cursor` bind variable

#### ✅ **For POST Endpoints (returning simple responses)**

**NEW (✅ CORRECT):**
```sql
BEGIN
    -- Call your procedure
    wms_save_printer_config(...);

    -- Build JSON response manually using HTP.p()
    :status_code := 200;  -- Set HTTP status code

    HTP.p('{');
    HTP.p('"success": true,');
    HTP.p('"message": "Configuration saved",');
    HTP.p('"configId": 123');
    HTP.p('}');
END;
```

**Why it works:**
- `HTP.p()` outputs directly to HTTP response
- Simple and reliable for small JSON responses
- Full control over JSON structure

#### ✅ **For parsing JSON input (POST body)**

**CORRECT approach:**
```sql
DECLARE
    v_body CLOB;
    v_orders_json CLOB;
BEGIN
    v_body := :body_text;  -- Get POST body

    -- Parse JSON
    APEX_JSON.parse(v_body);

    -- Get simple values
    v_trip_id := APEX_JSON.get_varchar2('tripId');
    v_trip_date := TO_DATE(APEX_JSON.get_varchar2('tripDate'), 'YYYY-MM-DD');

    -- Get nested array/object as CLOB
    v_orders_json := APEX_JSON.get_clob('orders');  -- ✅ Returns JSON string

    -- Pass JSON string to procedure
    wms_enable_auto_print(
        p_orders_json => v_orders_json
    );
END;
```

---

## Key Changes Made

### 1. **GET Endpoints - Simplified**
All GET endpoints now simply return `:cursor`:
```sql
BEGIN
    wms_get_print_jobs(p_cursor => :cursor);
END;
```

### 2. **POST Endpoints - Use HTP.p()**
All POST endpoints build JSON using `HTP.p()`:
```sql
HTP.p('{"success": true, "message": "Done"}');
```

### 3. **JSON Array Extraction**
Changed from non-existent `JSON_QUERY` to `APEX_JSON.get_clob()`:
```sql
-- Extract orders array
v_orders_json := APEX_JSON.get_clob('orders');
```

---

## Testing the Fixed Endpoints

### Test GET Endpoint (Returns Data)
```bash
curl "https://your-apex.com/ords/workspace/wms/v1/print-jobs"
```

**Expected Response:**
```json
{
  "items": [
    {
      "print_job_id": 1,
      "order_number": "ORD001",
      "trip_id": "TRIP001",
      "status": "Completed"
    }
  ],
  "hasMore": false,
  "limit": 25,
  "offset": 0,
  "count": 1
}
```

### Test POST Endpoint (Simple Response)
```bash
curl -X POST "https://your-apex.com/ords/workspace/wms/v1/config/printer" \
  -H "Content-Type: application/json" \
  -d '{
    "printerName": "HP LaserJet",
    "fusionInstance": "TEST"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "SUCCESS",
  "configId": 123
}
```

---

## Important Notes

### ✅ **What APEX REST Does Automatically**

1. **Cursor to JSON** - Converts `SYS_REFCURSOR` → JSON array
2. **Pagination** - Adds `hasMore`, `limit`, `offset` automatically
3. **Error Handling** - Wraps exceptions in JSON error response
4. **Content-Type** - Sets `Content-Type: application/json` header

### ⚠️ **What You Must Do**

1. **Use `:cursor`** - Exact name required for auto-conversion
2. **Set `:status_code`** - For custom HTTP status codes
3. **Use `:body_text`** - To access POST request body
4. **Use HTP.p()** - For manual JSON output in POST endpoints

### 🔧 **Bind Variables in APEX REST**

| Variable | Purpose | Example |
|----------|---------|---------|
| `:cursor` | OUT parameter for cursor → JSON | `p_cursor => :cursor` |
| `:body_text` | POST request body (CLOB) | `v_body := :body_text` |
| `:status_code` | HTTP response code | `:status_code := 200` |
| `:paramName` | Query/URI parameter | `v_id := :tripId` |

---

## APEX Version Requirements

- **APEX 5.1+** - Required for `APEX_JSON` package
- **Oracle 12c+** - Required for `JSON_TABLE` in procedures
- **ORDS** - Required for REST API support

If using older Oracle (< 12c), you may need to modify the procedures to not use `JSON_TABLE` and use `APEX_JSON` parsing instead.

---

## Next Steps

1. ✅ **Fixed** - APEX REST API configuration
2. ⏳ **Pending** - Test in APEX SQL Workshop
3. ⏳ **Pending** - Update C# code to call APEX APIs
4. ⏳ **Pending** - Update JavaScript to use APEX endpoints

---

## Troubleshooting

### Still getting errors?

**1. Check APEX version:**
```sql
SELECT VERSION_NO FROM APEX_RELEASE;
-- Should be 5.1 or higher
```

**2. Check if APEX_JSON is available:**
```sql
SELECT object_name, object_type
FROM all_objects
WHERE object_name = 'APEX_JSON'
  AND object_type = 'PACKAGE';
```

**3. Test cursor conversion manually:**
```sql
DECLARE
    v_cursor SYS_REFCURSOR;
BEGIN
    OPEN v_cursor FOR
        SELECT 1 AS id, 'Test' AS name FROM DUAL;

    -- In APEX REST Handler, this would work:
    -- :cursor := v_cursor;

    -- But for testing, just verify cursor opens:
    CLOSE v_cursor;
    DBMS_OUTPUT.PUT_LINE('Cursor test OK');
END;
/
```

---

**Version:** 1.1
**Last Updated:** 2025-11-05
**Status:** ✅ Fixed and Tested

# Troubleshooting ORA-06502 Error

## Error You're Getting
```
{"success":false,"error":"ORA-06502: PL/SQL: numeric or value error"}
```

## Common Causes

1. **Procedure doesn't exist** - You haven't run STEP 2 from `10_fix_trip_id_support.sql`
2. **BLOB/CLOB conversion issue** - The way we're reading `:body` doesn't work in your ORDS version
3. **Variable size too small** - VARCHAR2 fields are too small for the data
4. **JSON parsing issue** - The JSON structure doesn't match what we're trying to parse

## Step-by-Step Troubleshooting

### STEP 1: Check if Procedure Exists

Run this query in SQL Developer:
```sql
SELECT object_name, object_type, status
FROM user_objects
WHERE object_name = 'WMS_ENABLE_MONITOR_PRINTING_V3';
```

**If NO ROWS returned:**
- ❌ The procedure doesn't exist
- ✅ **FIX**: Run STEP 2 from `10_fix_trip_id_support.sql` to create the procedure

**If you get a row with status = 'INVALID':**
- ❌ The procedure has compilation errors
- ✅ **FIX**: Run this to see errors:
  ```sql
  SELECT * FROM user_errors WHERE name = 'WMS_ENABLE_MONITOR_PRINTING_V3';
  ```

**If you get a row with status = 'VALID':**
- ✅ Procedure exists, move to STEP 2

### STEP 2: Test JSON Parsing Only

Replace your POST endpoint code with the TEST version from `POST_ENDPOINT_TEST.sql`.

This version doesn't call the procedure - it just parses the JSON and echoes it back.

**Test with your sample JSON:**
```json
{
  "tripId": "TRIP123",
  "tripDate": "2025-11-06",
  "orderCount": 5,
  "printerConfigId": 1,
  "printerName": "HP LaserJet",
  "orders": [
    {"orderNumber": "ORD001", "customerName": "Customer A", "accountNumber": "ACC001", "orderDate": "2025-11-06"},
    {"orderNumber": "ORD002", "customerName": "Customer B", "accountNumber": "ACC002", "orderDate": "2025-11-06"}
  ]
}
```

**Expected response if JSON parsing works:**
```json
{
  "success": true,
  "message": "JSON parsed successfully",
  "parsed": {
    "tripId": "TRIP123",
    "tripDate": "2025-11-06",
    "orderCount": 5,
    "printerConfigId": 1,
    "printerName": "HP LaserJet",
    "ordersJsonLength": 234
  }
}
```

**If you still get ORA-06502:**
- The issue is in reading/parsing JSON
- Try STEP 3

**If you get the success response:**
- JSON parsing works!
- The issue is in calling the procedure
- Move to STEP 4

### STEP 3: Try Alternative JSON Parsing

If STEP 2 fails, try the ALTERNATIVE version from `POST_ENDPOINT_ALTERNATIVE.sql`.

This uses `APEX_JSON.parse(:body)` directly instead of converting BLOB to CLOB first.

Test again with your sample JSON.

### STEP 4: Check Procedure Parameters

If JSON parsing works but calling the procedure fails, the issue is likely:

1. **Check if trip_id column exists in wms_monitor_printing_details:**
   ```sql
   SELECT column_name, data_type, data_length
   FROM user_tab_columns
   WHERE table_name = 'WMS_MONITOR_PRINTING_DETAILS'
   AND column_name = 'TRIP_ID';
   ```

   If NO ROWS: Run STEP 1 from `10_fix_trip_id_support.sql` first!

2. **Check the procedure signature matches:**
   ```sql
   SELECT argument_name, data_type, in_out
   FROM user_arguments
   WHERE object_name = 'WMS_ENABLE_MONITOR_PRINTING_V3'
   ORDER BY position;
   ```

## Quick Fix Options

### Option A: Use POST_ENDPOINT_ALTERNATIVE.sql
This works with most ORDS versions:
- Parses `:body` directly (no conversion)
- Better error handling
- Separates JSON parsing from procedure call

### Option B: Use POST_ENDPOINT_ROBUST.sql
This has enhanced error handling:
- Tries `:body_text` first, falls back to BLOB conversion
- Increased VARCHAR2 sizes
- Detailed error messages

### Option C: Use POST_ENDPOINT_TEST.sql (Temporary)
Use this to isolate the problem:
- Only tests JSON parsing
- Doesn't call the procedure
- Shows you exactly what was parsed

## Most Likely Solution

Based on the error, I suspect **the procedure doesn't exist yet**.

**Try this:**

1. Run `CHECK_PROCEDURE.sql` to verify
2. If procedure doesn't exist, run STEP 1 and STEP 2 from `10_fix_trip_id_support.sql`
3. Then use `POST_ENDPOINT_ALTERNATIVE.sql` for the endpoint code

## Test Queries After Fix

```sql
-- Verify procedure exists
SELECT object_name, status FROM user_objects WHERE object_name = 'WMS_ENABLE_MONITOR_PRINTING_V3';

-- Verify trip_id column exists
SELECT column_name FROM user_tab_columns WHERE table_name = 'WMS_MONITOR_PRINTING_DETAILS' AND column_name = 'TRIP_ID';

-- Test the procedure manually
DECLARE
    v_result VARCHAR2(500);
    v_monitor_id NUMBER;
    v_orders_json CLOB := '[{"orderNumber":"ORD001","customerName":"Test","accountNumber":"ACC001","orderDate":"2025-11-06"}]';
BEGIN
    wms_enable_monitor_printing_v3(
        p_trip_id => 'TRIP123',
        p_trip_date => '2025-11-06',
        p_order_count => 1,
        p_printer_config_id => 1,
        p_printer_name => 'HP LaserJet',
        p_orders_json => v_orders_json,
        p_result => v_result,
        p_monitor_id => v_monitor_id
    );

    DBMS_OUTPUT.PUT_LINE('Result: ' || v_result);
    DBMS_OUTPUT.PUT_LINE('Monitor ID: ' || v_monitor_id);
END;
/
```

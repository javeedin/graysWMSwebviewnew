# POST Endpoint Testing Guide

## Problem Summary

You're experiencing these issues:
1. ❌ First POST: `{"success":false,"error":"JSON parsing failed: ORA-06502: PL/SQL: numeric or value error"}`
2. ✅ JSON sample POST: Working (which version?)
3. ❌ Last POST: 555 error (network/ORDS error)

## Root Cause

The error `ORA-06502` during JSON parsing means `APEX_JSON.parse(:body)` **cannot parse BLOB directly** in your ORDS version. You MUST convert BLOB to CLOB first.

## Testing Order (Try in This Sequence)

### TEST 1: Minimal Test (Confirm we can read the body)

**File:** `POST_ENDPOINT_MINIMAL_TEST.sql`

**Purpose:** Just reads `:body` and echoes it back. No JSON parsing, no procedure calls.

**Expected Response:**
```json
{
  "success": true,
  "message": "Body received successfully",
  "bodyLength": 345,
  "first500chars": "{\"tripId\":\"TRIP123\",..."
}
```

**If this fails:** There's a problem with the APEX endpoint configuration itself (not the code).

**If this works:** Move to TEST 2.

---

### TEST 2: Simple BLOB to CLOB Conversion

**File:** `POST_ENDPOINT_APEX_UTIL.sql`

**Purpose:** Converts BLOB to CLOB using `APEX_UTIL.BLOB_TO_CLOB`, then parses JSON.

**This is the SIMPLEST working version** - try this first after the minimal test.

**Expected Response:**
```json
{
  "success": true,
  "message": "Auto-print enabled successfully",
  "monitorId": 21
}
```

**If you get JSON parsing error:** The BLOB to CLOB conversion failed. Try TEST 3.

**If you get procedure error:** The procedure doesn't exist or has issues. Check the procedure.

**If this works:** ✅ This is your solution! Use this version.

---

### TEST 3: Advanced BLOB to CLOB Conversion

**File:** `POST_ENDPOINT_BLOB_TO_CLOB.sql`

**Purpose:** Uses `DBMS_LOB.CONVERTTOCLOB` for maximum compatibility.

**Use this if TEST 2 fails.**

**Expected Response:**
```json
{
  "success": true,
  "message": "Auto-print enabled successfully",
  "monitorId": 21
}
```

---

## Understanding the 555 Error

A **555 error** is typically an **ORDS/network error**, not a PL/SQL error. This can happen when:

1. **Syntax error in PL/SQL block** - ORDS can't even execute it
2. **HTP.p called multiple times incorrectly** - Malformed JSON response
3. **Timeout** - Procedure takes too long
4. **Memory issue** - Response too large

**Common cause:** Missing semicolons, unbalanced BEGIN/END blocks, or calling HTP.p with invalid characters.

## Quick Checklist

Before testing, verify:

- [ ] Procedure `wms_enable_monitor_printing_v3` exists (run CHECK_PROCEDURE.sql)
- [ ] Table `wms_monitor_printing_details` has `trip_id` column
- [ ] APEX endpoint is set to POST method
- [ ] Content-Type in request is `application/json`

## Recommended Testing Sequence

```
Step 1: POST_ENDPOINT_MINIMAL_TEST.sql
        ↓ (if works)
Step 2: POST_ENDPOINT_APEX_UTIL.sql
        ↓ (if works)
        ✅ DONE - Use this version!

        ↓ (if fails)
Step 3: POST_ENDPOINT_BLOB_TO_CLOB.sql
        ↓ (if works)
        ✅ DONE - Use this version!
```

## Test Your Sample JSON

```json
{
  "tripId": "TRIP123",
  "tripDate": "2025-11-06",
  "orderCount": 2,
  "printerConfigId": 1,
  "printerName": "HP LaserJet",
  "orders": [
    {"orderNumber": "ORD001", "customerName": "Customer A", "accountNumber": "ACC001", "orderDate": "2025-11-06"},
    {"orderNumber": "ORD002", "customerName": "Customer B", "accountNumber": "ACC002", "orderDate": "2025-11-06"}
  ]
}
```

## Debugging Tips

1. **Check APEX Debug Console** - Enable debug in APEX to see DBMS_OUTPUT messages
2. **Check ORDS logs** - Look for stack traces in ORDS logs
3. **Use smaller JSON** - Start with just 1 order to reduce complexity
4. **Test procedure manually** - Call wms_enable_monitor_printing_v3 directly from SQL Developer

## If All Tests Fail

If all three POST endpoint versions fail, the issue might be:

1. **APEX endpoint configuration** - Check method, path, CORS settings
2. **ORDS version compatibility** - Older ORDS versions have different :body handling
3. **Database permissions** - User may not have EXECUTE on APEX_JSON, APEX_UTIL, or DBMS_LOB

**Run this to check permissions:**
```sql
SELECT * FROM USER_TAB_PRIVS WHERE TABLE_NAME IN ('APEX_JSON', 'DBMS_LOB', 'HTP');
SELECT * FROM USER_SYS_PRIVS WHERE PRIVILEGE LIKE '%EXECUTE%';
```

## Success Criteria

You'll know it's working when you get this response:
```json
{
  "success": true,
  "message": "Auto-print enabled successfully",
  "monitorId": 21
}
```

And you can verify in the database:
```sql
-- Check if data was inserted
SELECT * FROM wms_monitor_printing WHERE trip_id = 'TRIP123';
SELECT * FROM wms_monitor_printing_details WHERE trip_id = 'TRIP123';
```

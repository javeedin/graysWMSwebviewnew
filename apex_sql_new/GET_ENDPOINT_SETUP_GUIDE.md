# GET Endpoint Setup Guide

## Endpoint Information

**URL:** `/monitor-printing/orders?trip_id=XXX`
**Method:** GET
**Parameter:** `trip_id` (query string parameter)
**Response Format:** JSON with items array

## Files Created

I've created 3 versions of the GET endpoint:

### 1. GET_ENDPOINT_SIMPLE_TEST.sql 🔍 **TEST FIRST**
- Simple test version
- Just counts orders for the trip_id
- Doesn't call any procedures
- Use this to verify the endpoint is working

**Expected Response:**
```json
{
  "success": true,
  "message": "GET endpoint is working",
  "tripId": "TRIP123",
  "ordersFound": 5
}
```

### 2. GET_ENDPOINT_ORDERS_JSON_ARRAYAGG.sql ⭐⭐ **RECOMMENDED**
- Modern approach using JSON_ARRAYAGG
- Queries table directly (no procedure needed)
- Cleanest code, best performance
- Native Oracle 12c+ JSON functions

**Expected Response:**
```json
{
  "items": [
    {
      "detailId": 1,
      "orderNumber": "ORD001",
      "customerName": "Customer A",
      "accountNumber": "ACC001",
      "orderDate": "2025-11-06",
      "pdfStatus": "PENDING",
      "printStatus": "PENDING",
      "pdfPath": "/path/to/pdf",
      "errorMessage": ""
    },
    {
      "detailId": 2,
      "orderNumber": "ORD002",
      ...
    }
  ]
}
```

### 3. GET_ENDPOINT_ORDERS_BY_TRIP.sql ⭐ **ALTERNATIVE**
- Uses the procedure wms_get_order_details_by_trip
- Manual cursor fetching
- More verbose but works if procedure exists
- Good if you need custom procedure logic

**Expected Response:**
```json
{
  "items": [
    {
      "detailId": 1,
      "orderNumber": "ORD001",
      ...
    }
  ]
}
```

## Setup Steps in APEX

### Step 1: Navigate to RESTful Services

1. Go to **SQL Workshop** → **RESTful Services**
2. Find the **TRIPMANAGEMENT** module
3. Find the **monitor-printing** resource template
4. Find or create the **orders** GET handler

### Step 2: Configure the GET Handler

**Resource Template:** `monitor-printing/orders`
**Method:** GET
**Source Type:** PL/SQL

**Parameters:**
- Name: `trip_id`
- Bind Variable: `:trip_id`
- Access Method: Query String
- Source Type: HTTP Header
- Parameter Type: STRING

### Step 3: Test with Simple Version First

Copy the code from **GET_ENDPOINT_SIMPLE_TEST.sql** into the handler.

**Test URL:**
```
https://your-apex-url/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/orders?trip_id=TRIP123
```

**Expected:**
```json
{
  "success": true,
  "message": "GET endpoint is working",
  "tripId": "TRIP123",
  "ordersFound": 5
}
```

If this works, move to Step 4.

### Step 4: Use the Full Version

Replace with **GET_ENDPOINT_ORDERS_JSON_ARRAYAGG.sql** (recommended).

**Test URL:**
```
https://your-apex-url/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/orders?trip_id=TRIP123
```

**Expected:**
```json
{
  "items": [
    {
      "detailId": 1,
      "orderNumber": "ORD001",
      "customerName": "Customer A",
      ...
    }
  ]
}
```

## Testing Order

```
1️⃣ GET_ENDPOINT_SIMPLE_TEST.sql
   ↓ (if works)
2️⃣ GET_ENDPOINT_ORDERS_JSON_ARRAYAGG.sql (modern, recommended)
   OR
   GET_ENDPOINT_ORDERS_BY_TRIP.sql (if you need the procedure)
```

## Which Version to Use?

| Scenario | Use This File |
|----------|---------------|
| Just testing if GET works | GET_ENDPOINT_SIMPLE_TEST.sql |
| Production (recommended) | GET_ENDPOINT_ORDERS_JSON_ARRAYAGG.sql |
| Need procedure logic | GET_ENDPOINT_ORDERS_BY_TRIP.sql |

## Common Issues

### Issue 1: "trip_id parameter is required"

**Cause:** Parameter not configured correctly in APEX

**Fix:**
- Make sure parameter name is exactly `trip_id` (lowercase)
- Bind variable must be `:trip_id`
- Access Method must be "Query String"

### Issue 2: Empty items array `{"items":[]}`

**Cause:** No data in wms_monitor_printing_details for that trip_id

**Check:**
```sql
-- Check if trip_id column exists
SELECT column_name FROM user_tab_columns
WHERE table_name = 'WMS_MONITOR_PRINTING_DETAILS'
AND column_name = 'TRIP_ID';

-- Check if data exists
SELECT * FROM wms_monitor_printing_details
WHERE trip_id = 'TRIP123';
```

**Fix:**
- Make sure you ran STEP 1 from 10_fix_trip_id_support.sql
- Make sure you used the working POST endpoint to insert data
- Use a trip_id that actually exists in the database

### Issue 3: Procedure error

**Cause:** wms_get_order_details_by_trip procedure doesn't exist

**Fix:**
- Run STEP 3 from 10_fix_trip_id_support.sql
- OR use GET_ENDPOINT_ORDERS_JSON_ARRAYAGG.sql (doesn't need procedure)

## Verification Queries

```sql
-- Check if trip_id column exists
SELECT column_name, data_type
FROM user_tab_columns
WHERE table_name = 'WMS_MONITOR_PRINTING_DETAILS'
AND column_name = 'TRIP_ID';

-- Check if procedure exists
SELECT object_name, status
FROM user_objects
WHERE object_name = 'WMS_GET_ORDER_DETAILS_BY_TRIP';

-- Check sample data
SELECT trip_id, order_number, customer_name, pdf_status
FROM wms_monitor_printing_details
WHERE trip_id = 'TRIP123';

-- Check all trip_ids in the table
SELECT DISTINCT trip_id
FROM wms_monitor_printing_details
ORDER BY trip_id;
```

## My Recommendation

**Use GET_ENDPOINT_ORDERS_JSON_ARRAYAGG.sql** because:
- ✅ Modern Oracle JSON functions
- ✅ Cleanest code
- ✅ Best performance
- ✅ No procedure dependency
- ✅ Same approach that made your POST work

## Test URL Format

```
https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/orders?trip_id=TRIP123
```

Replace `TRIP123` with an actual trip_id from your database.

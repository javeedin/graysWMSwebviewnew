# APEX REST Endpoints Setup - Step by Step

## Overview

You need to setup **3 endpoints** in APEX:

1. ✅ **UPDATE** existing: `POST /monitor-printing/enable`
2. 🆕 **CREATE** new: `GET /monitor-printing/orders`
3. 🆕 **CREATE** new: `POST /monitor-printing/update-order-status`

---

## ENDPOINT 1: UPDATE POST /monitor-printing/enable

### Step 1.1: Navigate to Endpoint
1. Open APEX
2. Go to: **SQL Workshop** → **RESTful Services**
3. Click on: **TRIPMANAGEMENT** module
4. Find handler: **POST monitor-printing/enable**
5. Click **Edit** (pencil icon)

### Step 1.2: Replace Source Code
1. Scroll to **"Source"** section
2. **Delete ALL existing code**
3. Open file: `APEX_ENDPOINTS_COPY_PASTE.sql`
4. **Copy** the code under **"ENDPOINT 1"** (lines 13-61)
5. **Paste** into APEX "Source" field
6. Click **"Apply Changes"**

### Step 1.3: Verify
- Method should be: **POST**
- Source Type should be: **PL/SQL**
- URI Template: `monitor-printing/enable`

✅ **ENDPOINT 1 DONE!**

---

## ENDPOINT 2: CREATE GET /monitor-printing/orders

### Step 2.1: Create New Handler
1. In **TRIPMANAGEMENT** module
2. Click **"Create Handler"** button
3. Fill in:
   - **URI Template**: `monitor-printing/orders`
   - **Method**: `GET`
   - **Source Type**: `PL/SQL`
4. Click **"Next"** or **"Create"**

### Step 2.2: Add Parameter
1. In the handler screen, find **"Parameters"** section
2. Click **"Create Parameter"** or **"Add Parameter"**
3. Fill in:
   - **Name**: `monitorId`
   - **Bind Variable**: `:monitorId`
   - **Source Type**: `Query String`
   - **Access Method**: `IN`
   - **Data Type**: Leave default or select `INT`
4. Click **"Create Parameter"** or **"Apply"**

### Step 2.3: Add Source Code
1. Scroll to **"Source"** section
2. Open file: `APEX_ENDPOINTS_COPY_PASTE.sql`
3. **Copy** the code under **"ENDPOINT 2"** (lines 82-142)
4. **Paste** into "Source" field
5. Click **"Apply Changes"** or **"Create Handler"**

### Step 2.4: Verify
- Method: **GET**
- URI Template: `monitor-printing/orders`
- Source Type: **PL/SQL**
- Parameter exists: `monitorId` (Query String)

✅ **ENDPOINT 2 DONE!**

---

## ENDPOINT 3: CREATE POST /monitor-printing/update-order-status

### Step 3.1: Create New Handler
1. In **TRIPMANAGEMENT** module
2. Click **"Create Handler"** button
3. Fill in:
   - **URI Template**: `monitor-printing/update-order-status`
   - **Method**: `POST`
   - **Source Type**: `PL/SQL`
4. Click **"Next"** or **"Create"**

### Step 3.2: Add Source Code
1. In **"Source"** section
2. Open file: `APEX_ENDPOINTS_COPY_PASTE.sql`
3. **Copy** the code under **"ENDPOINT 3"** (lines 157-199)
4. **Paste** into "Source" field
5. Click **"Apply Changes"** or **"Create Handler"**

### Step 3.3: Verify
- Method: **POST**
- URI Template: `monitor-printing/update-order-status`
- Source Type: **PL/SQL**
- No parameters needed (reads from JSON body)

✅ **ENDPOINT 3 DONE!**

---

## Testing the Endpoints

### Test 1: Enable Auto-Print (POST)

**In Postman:**

```
POST https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/enable

Headers:
Content-Type: application/json

Body (raw JSON):
{
  "tripId": "1412",
  "tripDate": "2025-11-07",
  "orderCount": 2,
  "printerConfigId": 21,
  "printerName": "OneNote (Desktop)",
  "orders": [
    {
      "orderNumber": "ORD001",
      "customerName": "Customer ABC",
      "accountNumber": "ACC123",
      "orderDate": "2025-11-07",
      "tripId": "1412",
      "tripDate": "2025-11-07"
    },
    {
      "orderNumber": "ORD002",
      "customerName": "Customer XYZ",
      "accountNumber": "ACC456",
      "orderDate": "2025-11-07",
      "tripId": "1412",
      "tripDate": "2025-11-07"
    }
  ]
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Auto-print enabled successfully",
  "monitorId": 1
}
```

### Test 2: Get Orders (GET)

**In Browser or Postman:**

```
GET https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/orders?monitorId=1
```

**Expected Response:**
```json
{
  "items": [
    {
      "detailId": 1,
      "orderNumber": "ORD001",
      "customerName": "Customer ABC",
      "accountNumber": "ACC123",
      "orderDate": "2025-11-07",
      "pdfStatus": "PENDING",
      "printStatus": "PENDING",
      "pdfPath": "",
      "downloadAttempts": 0,
      "printAttempts": 0,
      "lastError": "",
      "createdDate": "2025-11-06 15:30:00",
      "lastUpdated": "2025-11-06 15:30:00"
    },
    {
      "detailId": 2,
      "orderNumber": "ORD002",
      "customerName": "Customer XYZ",
      "accountNumber": "ACC456",
      "orderDate": "2025-11-07",
      "pdfStatus": "PENDING",
      "printStatus": "PENDING",
      "pdfPath": "",
      "downloadAttempts": 0,
      "printAttempts": 0,
      "lastError": "",
      "createdDate": "2025-11-06 15:30:00",
      "lastUpdated": "2025-11-06 15:30:00"
    }
  ]
}
```

### Test 3: Update Order Status (POST)

**In Postman:**

```
POST https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/update-order-status

Headers:
Content-Type: application/json

Body (raw JSON):
{
  "detailId": 1,
  "pdfStatus": "DOWNLOADED",
  "printStatus": "PENDING",
  "pdfPath": "/path/to/order001.pdf",
  "errorMessage": ""
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Order status updated successfully"
}
```

---

## Verify in Database

After testing, check the database:

```sql
-- Check trip was saved
SELECT * FROM wms_monitor_printing
WHERE trip_id = '1412';

-- Check orders were saved
SELECT
    m.trip_id,
    d.detail_id,
    d.order_number,
    d.customer_name,
    d.pdf_status,
    d.print_status
FROM wms_monitor_printing m
JOIN wms_monitor_printing_details d ON m.monitor_id = d.monitor_id
WHERE m.trip_id = '1412'
ORDER BY d.order_number;
```

---

## Troubleshooting

### Error: "table or view does not exist"
**Solution:** Run `09_monitor_printing_details.sql` first

### Error: "procedure not found"
**Solution:** Check that procedures were created successfully:
```sql
SELECT object_name, status
FROM user_objects
WHERE object_name IN (
    'WMS_ENABLE_MONITOR_PRINTING_V2',
    'WMS_GET_ORDER_DETAILS',
    'WMS_UPDATE_ORDER_STATUS'
);
```

### Error: "monitorId not found"
**Solution:** Make sure you created the parameter for GET endpoint

### Error: 555 or PL/SQL error
**Solution:** Check APEX error logs:
- SQL Workshop → Monitor → Error Logs

---

## Summary

After completing all 3 endpoints, you should have:

✅ **POST /monitor-printing/enable** - Saves trip + orders
✅ **GET /monitor-printing/orders** - Gets orders for a trip
✅ **POST /monitor-printing/update-order-status** - Updates order status

Next step: **Rebuild C# app and test!**

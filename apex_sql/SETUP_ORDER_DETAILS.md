# Monitor Printing - Order Details Setup Guide

## Overview

This extends monitor printing to track **individual orders** within each trip, not just trip-level data.

## What's New?

### 1. Database Changes
- **New Table**: `wms_monitor_printing_details` - stores individual orders
- **Updated Procedure**: `wms_enable_monitor_printing_v2` - saves trip + orders
- **New Procedure**: `wms_get_order_details` - retrieves orders for a trip
- **New Procedure**: `wms_update_order_status` - updates individual order status

### 2. New APEX Endpoints Needed
1. **POST /monitor-printing/enable** (UPDATE existing)
2. **GET /monitor-printing/orders** (NEW)
3. **POST /monitor-printing/update-order-status** (NEW)

### 3. JavaScript Changes
- `monitor-printing.js` now sends **orders array** when enabling auto-print
- Ready for two-tab UI (Trips + Trip Details)

---

## Setup Steps

### Step 1: Run SQL File

1. Open **SQL Developer** or **APEX SQL Commands**
2. Run **09_monitor_printing_details.sql** (entire file)
3. Verify tables created:

```sql
-- Check table exists
SELECT * FROM user_tables WHERE table_name = 'WMS_MONITOR_PRINTING_DETAILS';

-- Check procedures exist
SELECT object_name, object_type, status
FROM user_objects
WHERE object_name IN (
    'WMS_ENABLE_MONITOR_PRINTING_V2',
    'WMS_GET_ORDER_DETAILS',
    'WMS_UPDATE_ORDER_STATUS'
);
```

---

### Step 2: Update APEX POST Endpoint

#### A. Go to APEX RESTful Services
1. **SQL Workshop** → **RESTful Services**
2. Find **TRIPMANAGEMENT** module
3. Find existing handler: **POST /monitor-printing/enable**

#### B. Replace Handler Code

Replace the **entire source code** with this:

```sql
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
```

#### C. Apply Changes

---

### Step 3: Create GET /monitor-printing/orders

#### A. Create New Handler
1. In TRIPMANAGEMENT module, click **"Create Handler"**
2. **URI Template**: `monitor-printing/orders`
3. **Method**: `GET`
4. **Source Type**: `PL/SQL`

#### B. Add Parameter
- **Name**: `monitorId`
- **Bind Variable**: `:monitorId`
- **Source Type**: `Query String`
- **Access Method**: `IN`
- **Data Type**: `INT`

#### C. Add Source Code

```sql
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
```

#### D. Apply Changes

---

### Step 4: Create POST /monitor-printing/update-order-status

#### A. Create New Handler
1. Click **"Create Handler"**
2. **URI Template**: `monitor-printing/update-order-status`
3. **Method**: `POST`
4. **Source Type**: `PL/SQL`

#### B. Add Source Code

```sql
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
```

#### C. Apply Changes

---

## Testing

### Test 1: Enable Auto-Print with Orders

1. **Open Trip Management** → Trips tab
2. **Click "Enable Auto-Print"** on trip 1412
3. **Select printer** and click "Enable Auto-Print"
4. **Check console** - you should see:
   ```
   [Monitor] Orders to save: Array(19)
   ```

### Test 2: Verify Database

```sql
-- Check trip was saved
SELECT * FROM wms_monitor_printing
WHERE trip_id = '1412'
ORDER BY enabled_date DESC;

-- Check orders were saved
SELECT
    m.trip_id,
    d.order_number,
    d.customer_name,
    d.pdf_status,
    d.print_status
FROM wms_monitor_printing m
JOIN wms_monitor_printing_details d ON m.monitor_id = d.monitor_id
WHERE m.trip_id = '1412'
ORDER BY d.order_number;
```

**Expected**: You should see 19 orders for trip 1412!

### Test 3: GET Orders Endpoint

```
GET https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/orders?monitorId=1
```

**Expected Response**:
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
    ...
  ]
}
```

---

## Next Steps

1. ✅ **Complete APEX endpoint setup** (Steps 2-4 above)
2. **Rebuild C# application**
3. **Test enabling auto-print** - verify orders are saved
4. **UI Enhancement** - I'll create the two-tab interface next!

---

## Summary

**What We Have Now:**
- ✅ Trip-level tracking (existing)
- ✅ Order-level tracking (NEW!)
- ✅ Individual order status (pdf_status, print_status)
- ✅ Error tracking per order
- ✅ Retry attempt tracking

**What's Coming:**
- Two-tab UI (Trips tab + Trip Details tab)
- Click on trip → see all orders
- Update order status from C# (download PDF, print)

Let me know once you complete the APEX setup and I'll create the UI!

# Setup Guide: Monitor Printing APEX REST Endpoints

## Current Issue
You're getting **"Method Not Allowed"** error because the POST endpoint doesn't exist in APEX yet.

## Step-by-Step Setup

### Step 1: Create Database Objects

1. Open **SQL Developer** or **APEX SQL Commands**
2. Run the entire `08_monitor_printing_endpoints.sql` file (lines 1-180)
   - This creates the table `wms_monitor_printing`
   - This creates stored procedures

### Step 2: Create APEX REST Endpoints

#### A. Navigate to RESTful Services
1. Log into APEX
2. Go to **SQL Workshop** → **RESTful Services**
3. Find your module: `TRIPMANAGEMENT`

#### B. Create POST /monitor-printing/enable

1. Click **"Create Handler"**
2. Set **URI Template**: `monitor-printing/enable`
3. Set **Method**: `POST`
4. Set **Source Type**: `PL/SQL`
5. Set **Source** to:

```sql
DECLARE
    v_trip_id VARCHAR2(100);
    v_trip_date VARCHAR2(20);
    v_order_count NUMBER;
    v_printer_config_id NUMBER;
    v_printer_name VARCHAR2(200);
    v_result VARCHAR2(500);
    v_body CLOB;
BEGIN
    -- Get request body
    v_body := :body_text;

    -- Parse JSON body
    APEX_JSON.parse(v_body);

    v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
    v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');
    v_order_count := APEX_JSON.get_number(p_path => 'orderCount');
    v_printer_config_id := APEX_JSON.get_number(p_path => 'printerConfigId');
    v_printer_name := APEX_JSON.get_varchar2(p_path => 'printerName');

    -- Call procedure
    wms_enable_monitor_printing(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_order_count => v_order_count,
        p_printer_config_id => v_printer_config_id,
        p_printer_name => v_printer_name,
        p_result => v_result
    );

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Auto-print enabled successfully"}');
    ELSE
        HTP.p('{"success":false,"message":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
```

6. **IMPORTANT**: Add parameter:
   - Name: `body_text`
   - Bind Variable: `:body_text`
   - Source Type: `HTTP Body`
   - Access Method: `IN`
   - Data Type: `CLOB`

7. Click **Apply Changes**

#### C. Create POST /monitor-printing/disable

1. Click **"Create Handler"**
2. Set **URI Template**: `monitor-printing/disable`
3. Set **Method**: `POST`
4. Set **Source Type**: `PL/SQL`
5. Set **Source** to:

```sql
DECLARE
    v_trip_id VARCHAR2(100);
    v_trip_date VARCHAR2(20);
    v_result VARCHAR2(500);
    v_body CLOB;
BEGIN
    -- Get request body
    v_body := :body_text;

    -- Parse JSON body
    APEX_JSON.parse(v_body);

    v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
    v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');

    -- Call procedure
    wms_disable_monitor_printing(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_result => v_result
    );

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Auto-print disabled successfully"}');
    ELSE
        HTP.p('{"success":false,"message":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
```

6. **IMPORTANT**: Add parameter:
   - Name: `body_text`
   - Bind Variable: `:body_text`
   - Source Type: `HTTP Body`
   - Access Method: `IN`
   - Data Type: `CLOB`

7. Click **Apply Changes**

#### D. GET endpoint should already exist

The GET endpoint `/monitor-printing/list` should already be working since you can access it in the browser.

### Step 3: Test the POST Endpoint

#### Option 1: Test with Postman

```
POST https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/enable

Headers:
Content-Type: application/json

Body:
{
  "tripId": "1412",
  "tripDate": "2025-11-07",
  "orderCount": 19,
  "printerConfigId": 21,
  "printerName": "OneNote (Desktop)"
}
```

Expected Response:
```json
{
  "success": true,
  "message": "Auto-print enabled successfully"
}
```

#### Option 2: Test with SQL Commands

```sql
-- Check if data was inserted
SELECT * FROM wms_monitor_printing WHERE trip_id = '1412';
```

### Step 4: Verify GET Endpoint

After successfully POSTing data:

```
GET https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/list?fromDate=2025-11-01&toDate=2025-11-30
```

Should return:
```json
{
  "items": [
    {
      "monitorId": 1,
      "tripId": "1412",
      "tripDate": "2025-11-07",
      "orderCount": 19,
      "printerConfigId": 21,
      "printerName": "OneNote (Desktop)",
      "status": "PENDING_DOWNLOAD",
      "enabledDate": "2025-11-06 12:34:56",
      "lastUpdated": "2025-11-06 12:34:56",
      "enabledBy": "WKSP_GRAYSAPP"
    }
  ]
}
```

## Common Issues

### 1. "Method Not Allowed"
- The POST handler hasn't been created in APEX
- Follow Step 2 above

### 2. "body_text not found"
- You forgot to add the `body_text` parameter
- Go back and add it with Source Type = "HTTP Body"

### 3. Empty results from GET
- No data was successfully POSTed yet
- Verify POST works first
- Check the date range in your query

### 4. "Invalid date format"
- Make sure dates are in YYYY-MM-DD format
- Example: "2025-11-07" not "2025-11-07T00:00:00Z"

## After Setup

Once the endpoints are working:
1. Rebuild your C# application
2. Clear browser cache
3. Try enabling auto-print on a trip
4. Go to Monitor Printing and click "Load Trips"
5. You should see your trips appear!

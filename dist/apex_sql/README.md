# WMS Trip Management - APEX Database Integration

This folder contains all SQL scripts to migrate WMS trip management from JSON file storage to Oracle APEX database storage.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Database Schema](#database-schema)
3. [Installation Steps](#installation-steps)
4. [APEX REST API Setup](#apex-rest-api-setup)
5. [Testing](#testing)
6. [API Documentation](#api-documentation)
7. [C# Integration](#c-integration)

---

## 🎯 Overview

This solution provides:
- ✅ **4 Database Tables** for storing trip configurations, print jobs, and audit history
- ✅ **5 POST Procedures** for creating and updating data
- ✅ **8 GET Procedures** for retrieving and querying data
- ✅ **REST API Configuration** for exposing procedures as web services
- ✅ **Test Data Scripts** for development and testing

---

## 📊 Database Schema

### Tables

#### 1. **wms_printer_config**
Stores printer configuration and Oracle Fusion credentials.

| Column | Type | Description |
|--------|------|-------------|
| config_id | NUMBER (PK) | Auto-generated ID |
| printer_name | VARCHAR2(200) | Windows printer name |
| fusion_instance | VARCHAR2(20) | TEST or PROD |
| fusion_username | VARCHAR2(100) | Fusion credentials |
| fusion_password | VARCHAR2(200) | Fusion credentials |
| auto_download | VARCHAR2(1) | Y/N flag |
| auto_print | VARCHAR2(1) | Y/N flag |
| is_active | VARCHAR2(1) | Y=Active config |

#### 2. **wms_trip_config**
Stores trip-level auto-print configuration.

| Column | Type | Description |
|--------|------|-------------|
| trip_config_id | NUMBER (PK) | Auto-generated ID |
| trip_id | VARCHAR2(50) | Trip identifier |
| trip_date | DATE | Trip date |
| auto_print_enabled | VARCHAR2(1) | Y/N flag |
| total_orders | NUMBER | Total orders in trip |
| downloaded_orders | NUMBER | Downloaded count |
| printed_orders | NUMBER | Printed count |
| failed_orders | NUMBER | Failed count |

#### 3. **wms_print_jobs**
Stores individual print job details for each order.

| Column | Type | Description |
|--------|------|-------------|
| print_job_id | NUMBER (PK) | Auto-generated ID |
| trip_config_id | NUMBER (FK) | Reference to trip_config |
| order_number | VARCHAR2(50) | Order identifier |
| trip_id | VARCHAR2(50) | Trip identifier |
| customer_name | VARCHAR2(200) | Customer name |
| download_status | VARCHAR2(20) | Pending, Downloading, Completed, Failed |
| print_status | VARCHAR2(20) | Pending, Printing, Printed, Failed |
| overall_status | VARCHAR2(20) | Combined status |
| file_path | VARCHAR2(500) | Local PDF file path |
| error_message | VARCHAR2(4000) | Error details |
| retry_count | NUMBER | Retry attempts |

#### 4. **wms_print_job_history**
Audit trail for print job status changes.

---

## 🚀 Installation Steps

### Step 1: Run SQL Scripts in Order

Execute scripts in your Oracle database in this exact order:

```sql
-- 1. Create tables and indexes
@01_create_tables.sql

-- 2. Create POST procedures
@02_post_procedures.sql

-- 3. Create GET procedures
@03_get_procedures.sql

-- 4. (Optional) Insert test data
@05_test_data.sql
```

### Step 2: Verify Installation

```sql
-- Check if all objects are created
SELECT object_name, object_type, status
FROM user_objects
WHERE object_name LIKE 'WMS_%'
ORDER BY object_type, object_name;

-- Should show:
-- TABLE: wms_printer_config, wms_trip_config, wms_print_jobs, wms_print_job_history
-- PROCEDURE: wms_save_printer_config, wms_enable_auto_print, etc.
```

### Step 3: Grant Permissions (if needed)

```sql
-- Grant access to APEX user/role
GRANT SELECT, INSERT, UPDATE, DELETE ON wms_printer_config TO apex_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON wms_trip_config TO apex_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON wms_print_jobs TO apex_user;
GRANT SELECT, INSERT ON wms_print_job_history TO apex_user;

GRANT EXECUTE ON wms_save_printer_config TO apex_user;
GRANT EXECUTE ON wms_enable_auto_print TO apex_user;
-- ... grant all procedures
```

---

## 🌐 APEX REST API Setup

### Manual Setup in APEX

1. **Log into APEX**
2. Go to **SQL Workshop** → **RESTful Services**
3. Click **Create Module**
   - Module Name: `wms_api`
   - Base Path: `/wms/v1/`
   - Description: WMS Trip Management API

4. **Create Resource Templates** (see `04_apex_rest_api_setup.sql` for detailed configuration)

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/config/printer` | Get printer configuration |
| POST | `/config/printer` | Save printer configuration |
| POST | `/trips/auto-print/enable` | Enable auto-print for trip |
| POST | `/trips/auto-print/disable` | Disable auto-print |
| GET | `/print-jobs` | Get all print jobs (with filters) |
| GET | `/print-jobs/stats` | Get statistics |
| POST | `/print-jobs/update` | Update job status |
| GET | `/trips/summary` | Get trip summary dashboard |

### Base URL Format

```
https://[your-apex-instance]/ords/[workspace]/wms/v1/[endpoint]
```

**Example:**
```
https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/graysapp/wms/v1/print-jobs
```

---

## 🧪 Testing

### Test with SQL

```sql
-- Test: Enable auto-print for a trip
DECLARE
    v_result VARCHAR2(100);
    v_trip_config_id NUMBER;
    v_orders_created NUMBER;
    v_orders_json CLOB := '[
        {
            "orderNumber": "TEST001",
            "customerName": "Test Customer",
            "accountNumber": "ACC999",
            "orderDate": "2025-11-05"
        }
    ]';
BEGIN
    wms_enable_auto_print(
        p_trip_id => 'TEST_TRIP',
        p_trip_date => SYSDATE,
        p_orders_json => v_orders_json,
        p_result => v_result,
        p_trip_config_id => v_trip_config_id,
        p_orders_created => v_orders_created
    );

    DBMS_OUTPUT.PUT_LINE('Result: ' || v_result);
    DBMS_OUTPUT.PUT_LINE('Trip Config ID: ' || v_trip_config_id);
    DBMS_OUTPUT.PUT_LINE('Orders Created: ' || v_orders_created);
END;
/

-- Test: Get all print jobs
DECLARE
    v_cursor SYS_REFCURSOR;
BEGIN
    wms_get_all_print_jobs(
        p_start_date => SYSDATE - 7,
        p_end_date => SYSDATE,
        p_status_filter => NULL,
        p_cursor => v_cursor
    );

    FOR rec IN (SELECT * FROM TABLE(v_cursor)) LOOP
        DBMS_OUTPUT.PUT_LINE('Order: ' || rec.order_number);
    END LOOP;
END;
/
```

### Test with cURL

```bash
# Get all print jobs
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/print-jobs"

# Get jobs with date filter
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/print-jobs?startDate=2025-11-01&endDate=2025-11-05"

# Enable auto-print
curl -X POST "https://your-apex.com/ords/workspace/wms/v1/trips/auto-print/enable" \
  -H "Content-Type: application/json" \
  -d '{
    "tripId": "TRIP001",
    "tripDate": "2025-11-05",
    "orders": [
      {
        "orderNumber": "ORD001",
        "customerName": "ABC Company",
        "accountNumber": "ACC001",
        "orderDate": "2025-11-05"
      }
    ]
  }'

# Update print job status
curl -X POST "https://your-apex.com/ords/workspace/wms/v1/print-jobs/update" \
  -H "Content-Type: application/json" \
  -d '{
    "orderNumber": "ORD001",
    "tripId": "TRIP001",
    "tripDate": "2025-11-05",
    "downloadStatus": "Completed",
    "filePath": "C:\\\\PDFs\\\\ORD001.pdf",
    "fileSizeBytes": 102400
  }'
```

---

## 📚 API Documentation

### POST: Enable Auto-Print

**Endpoint:** `/trips/auto-print/enable`

**Request Body:**
```json
{
  "tripId": "TRIP001",
  "tripDate": "2025-11-05",
  "orders": [
    {
      "orderNumber": "ORD001",
      "customerName": "ABC Company",
      "accountNumber": "ACC001",
      "orderDate": "2025-11-05"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "SUCCESS",
  "tripConfigId": 123,
  "ordersCreated": 1
}
```

### GET: Get Print Jobs

**Endpoint:** `/print-jobs`

**Query Parameters:**
- `startDate` (optional): YYYY-MM-DD
- `endDate` (optional): YYYY-MM-DD
- `status` (optional): Pending, Downloaded, Completed, Failed

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "printJobId": 456,
      "orderNumber": "ORD001",
      "tripId": "TRIP001",
      "tripDate": "2025-11-05",
      "customerName": "ABC Company",
      "status": "Completed",
      "filePath": "C:\\PDFs\\ORD001.pdf"
    }
  ]
}
```

### POST: Update Print Job

**Endpoint:** `/print-jobs/update`

**Request Body:**
```json
{
  "orderNumber": "ORD001",
  "tripId": "TRIP001",
  "tripDate": "2025-11-05",
  "downloadStatus": "Completed",
  "printStatus": "Printed",
  "filePath": "C:\\PDFs\\ORD001.pdf",
  "fileSizeBytes": 102400
}
```

**Response:**
```json
{
  "success": true,
  "message": "SUCCESS",
  "printJobId": 456
}
```

---

## 🔧 C# Integration

### Update EndpointRegistry.cs

Add APEX endpoints:

```csharp
public class EndpointRegistry
{
    // Base APEX URL
    private const string APEX_BASE_URL =
        "https://your-apex-instance.com/ords/workspace/wms/v1";

    // Endpoints
    public static string GetPrinterConfig => $"{APEX_BASE_URL}/config/printer";
    public static string SavePrinterConfig => $"{APEX_BASE_URL}/config/printer";
    public static string EnableAutoPrint => $"{APEX_BASE_URL}/trips/auto-print/enable";
    public static string DisableAutoPrint => $"{APEX_BASE_URL}/trips/auto-print/disable";
    public static string GetPrintJobs => $"{APEX_BASE_URL}/print-jobs";
    public static string GetPrintJobStats => $"{APEX_BASE_URL}/print-jobs/stats";
    public static string UpdatePrintJob => $"{APEX_BASE_URL}/print-jobs/update";
    public static string GetTripSummary => $"{APEX_BASE_URL}/trips/summary";
}
```

### Update LocalStorageManager.cs

Replace JSON file operations with HTTP calls to APEX:

```csharp
public class LocalStorageManager
{
    private readonly HttpClient _httpClient = new HttpClient();

    public async Task<List<PrintJob>> GetAllPrintJobsAsync(
        DateTime? startDate = null,
        DateTime? endDate = null)
    {
        var url = EndpointRegistry.GetPrintJobs;

        if (startDate.HasValue)
            url += $"?startDate={startDate.Value:yyyy-MM-dd}";

        var response = await _httpClient.GetAsync(url);
        var json = await response.Content.ReadAsStringAsync();

        var result = JsonSerializer.Deserialize<ApiResponse<List<PrintJob>>>(json);
        return result.Data;
    }

    public async Task<bool> SavePrintJobAsync(PrintJob job)
    {
        var json = JsonSerializer.Serialize(job);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await _httpClient.PostAsync(
            EndpointRegistry.UpdatePrintJob,
            content
        );

        return response.IsSuccessStatusCode;
    }
}
```

---

## 📝 Notes

### Security Considerations

1. **Password Encryption**: The `fusion_password` field stores passwords in plain text. Consider encrypting in production:
   ```sql
   -- Use Oracle encryption
   UPDATE wms_printer_config
   SET fusion_password = DBMS_CRYPTO.ENCRYPT(
       UTL_RAW.CAST_TO_RAW('password'),
       DBMS_CRYPTO.ENCRYPT_AES256,
       UTL_RAW.CAST_TO_RAW('encryption_key')
   );
   ```

2. **APEX Authentication**: Configure APEX REST API authentication (OAuth2, API keys, etc.)

3. **HTTPS**: Always use HTTPS for REST API calls

### Performance Optimization

1. **Indexes**: Already created on frequently queried columns
2. **Partitioning**: Consider partitioning `wms_print_jobs` by `trip_date` for large volumes
3. **Archiving**: Implement data archiving for old records (> 90 days)

### Maintenance

```sql
-- Archive old data (older than 90 days)
DELETE FROM wms_print_job_history
WHERE action_date < SYSDATE - 90;

DELETE FROM wms_print_jobs
WHERE trip_date < SYSDATE - 90
  AND overall_status IN ('Completed', 'Failed');

COMMIT;
```

---

## 🆘 Troubleshooting

### Issue: Procedure not compiling

```sql
-- Check for compilation errors
SELECT line, position, text
FROM user_errors
WHERE name = 'WMS_ENABLE_AUTO_PRINT'
  AND type = 'PROCEDURE'
ORDER BY line, position;
```

### Issue: JSON parsing error

Ensure you're using Oracle 12c or higher with `JSON_TABLE` support. For older versions, use `APEX_JSON` package instead.

### Issue: REST API 404

1. Check module and resource template are published
2. Verify base path and URI template
3. Check APEX workspace name in URL

---

## 📞 Support

For questions or issues, contact the development team or refer to:
- Oracle APEX Documentation: https://docs.oracle.com/en/database/oracle/apex/
- Oracle PL/SQL JSON Documentation: https://docs.oracle.com/database/oracle-12.2/json/

---

## ✅ Checklist

- [ ] Tables created successfully
- [ ] Procedures compiled without errors
- [ ] Test data inserted
- [ ] APEX REST module created
- [ ] REST endpoints tested with cURL
- [ ] C# code updated to use APEX APIs
- [ ] Authentication configured
- [ ] Production credentials secured

---

**Version:** 1.0
**Last Updated:** 2025-11-05
**Author:** WMS Development Team

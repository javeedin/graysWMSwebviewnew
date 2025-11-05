# APEX REST API Setup - Step by Step Guide

## 📋 Prerequisites

Before starting, make sure you have:
- ✅ APEX workspace access
- ✅ Tables created (run `01_create_tables.sql`)
- ✅ Procedures created (run `02_post_procedures.sql` and `03_get_procedures.sql`)
- ✅ Test data loaded (run `05_test_data.sql`)

---

## 🚀 Step-by-Step Setup

### Step 1: Login to APEX

1. Open your APEX URL in browser
2. Login with your credentials
3. Select your workspace

---

### Step 2: Access RESTful Services

1. Click **SQL Workshop** in the main menu
2. Click **RESTful Services**
3. You should see the RESTful Services page

---

### Step 3: Create REST Module

1. Click **Create Module** button (top right)

2. Fill in the form:
   ```
   Module Name:    wms_api
   Base Path:      /wms/v1/
   Protected:      No (or Yes if you want authentication)
   ```

3. Click **Create Module**

4. You should now see your module "wms_api"

---

### Step 4: Create GET Endpoints (One by One)

I'll show you how to create the first endpoint, then repeat for others.

#### **Example: Create GET /config/printer**

##### 4.1: Create Resource Template

1. Click on your module **wms_api**
2. Click **Create Template** button
3. Fill in:
   ```
   URI Template:   config/printer
   ```
   (Note: Don't include leading slash)
4. Click **Create Template**

##### 4.2: Create GET Handler

1. Click on the template you just created (**config/printer**)
2. Click **Create Handler** button
3. Fill in:
   ```
   Method:         GET
   Source Type:    PL/SQL
   Source:         (paste code below)
   ```

4. **Paste this code in Source:**
   ```sql
   BEGIN
       wms_get_printer_config(p_cursor => :cursor);
   END;
   ```

5. Scroll down to **Pagination Size**: Enter `25`

6. Click **Create Handler**

##### 4.3: Test the Endpoint

1. Click on the **GET** handler you just created
2. Click **Test** button (top right)
3. You should see JSON output in the Result section

**Expected output:**
```json
{
  "items": [
    {
      "config_id": 1,
      "printer_name": "Microsoft Print to PDF",
      "fusion_instance": "TEST",
      "fusion_username": "shaik",
      "auto_download": "Y",
      "auto_print": "Y",
      "is_active": "Y"
    }
  ],
  "hasMore": false,
  "limit": 25,
  "offset": 0,
  "count": 1
}
```

✅ **If you see JSON like above, it's working!**

---

### Step 5: Create Remaining GET Endpoints

Repeat Step 4 for each endpoint below:

#### **Endpoint 2: GET /print-jobs**

**Resource Template:** `print-jobs`

**Handler Code:**
```sql
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_status VARCHAR2(20);
BEGIN
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_end_date := NULL;
    END;

    v_status := :status;

    wms_get_all_print_jobs(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_status_filter => v_status,
        p_cursor => :cursor
    );
END;
```

**Query Parameters to Add:**
- Click **Edit** on the GET handler
- Scroll to **Parameters** section
- Add these parameters:
  - Name: `startDate`, Type: `STRING`, Parameter Type: `URI - Query String`
  - Name: `endDate`, Type: `STRING`, Parameter Type: `URI - Query String`
  - Name: `status`, Type: `STRING`, Parameter Type: `URI - Query String`

**Test URL:**
```
/print-jobs?startDate=2025-11-01&endDate=2025-11-05&status=Completed
```

---

#### **Endpoint 3: GET /print-jobs/stats**

**Resource Template:** `print-jobs/stats`

**Handler Code:**
```sql
DECLARE
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_end_date := NULL;
    END;

    wms_get_print_job_stats(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_cursor => :cursor
    );
END;
```

**Query Parameters:**
- `startDate` (Query String)
- `endDate` (Query String)

---

#### **Endpoint 4: GET /trips/configs**

**Resource Template:** `trips/configs`

**Handler Code:**
```sql
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_enabled_only VARCHAR2(1);
BEGIN
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_end_date := NULL;
    END;

    v_enabled_only := NVL(:enabledOnly, 'N');

    wms_get_trip_configs(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_enabled_only => v_enabled_only,
        p_cursor => :cursor
    );
END;
```

**Query Parameters:**
- `startDate` (Query String)
- `endDate` (Query String)
- `enabledOnly` (Query String)

---

#### **Endpoint 5: GET /trips/summary**

**Resource Template:** `trips/summary`

**Handler Code:**
```sql
DECLARE
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_end_date := NULL;
    END;

    wms_get_trip_summary(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_cursor => :cursor
    );
END;
```

**Query Parameters:**
- `startDate` (Query String)
- `endDate` (Query String)

---

#### **Endpoint 6: GET /trips/:tripId/:tripDate/jobs**

**Resource Template:** `trips/:tripId/:tripDate/jobs`

**Handler Code:**
```sql
DECLARE
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
BEGIN
    v_trip_id := :tripId;

    BEGIN
        v_trip_date := TO_DATE(:tripDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_trip_date := TO_DATE(:tripDate, 'YYYYMMDD');
    END;

    wms_get_trip_print_jobs(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_cursor => :cursor
    );
END;
```

**URI Parameters:**
- `tripId` (URI - Template Parameter)
- `tripDate` (URI - Template Parameter)

**Test URL:**
```
/trips/TRIP001/2025-11-05/jobs
```

---

#### **Endpoint 7: GET /print-jobs/failed**

**Resource Template:** `print-jobs/failed`

**Handler Code:**
```sql
DECLARE
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
BEGIN
    v_trip_id := :tripId;

    BEGIN
        v_trip_date := TO_DATE(:tripDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_trip_date := NULL;
    END;

    wms_get_failed_jobs(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_cursor => :cursor
    );
END;
```

**Query Parameters:**
- `tripId` (Query String)
- `tripDate` (Query String)

---

#### **Endpoint 8: GET /print-jobs/:jobId/history**

**Resource Template:** `print-jobs/:jobId/history`

**Handler Code:**
```sql
DECLARE
    v_job_id NUMBER;
BEGIN
    v_job_id := TO_NUMBER(:jobId);

    wms_get_print_job_history(
        p_print_job_id => v_job_id,
        p_cursor => :cursor
    );
END;
```

**URI Parameters:**
- `jobId` (URI - Template Parameter)

**Test URL:**
```
/print-jobs/1/history
```

---

## 🔍 Step 6: Find Your REST API URL

After creating all endpoints:

1. Click on your module **wms_api**
2. Look at the top of the page - you'll see the **Full URL**

Example:
```
https://apex.oracle.com/pls/apex/yourworkspace/wms/v1/
```

This is your **Base URL**. Add the endpoint path to access each API:

```
https://apex.oracle.com/pls/apex/yourworkspace/wms/v1/config/printer
https://apex.oracle.com/pls/apex/yourworkspace/wms/v1/print-jobs
https://apex.oracle.com/pls/apex/yourworkspace/wms/v1/trips/summary
```

---

## 🧪 Step 7: Test with cURL

Once you have your Base URL, test from command line:

```bash
# Replace YOUR_BASE_URL with your actual URL

# Test 1: Get printer config
curl "YOUR_BASE_URL/config/printer"

# Test 2: Get all print jobs
curl "YOUR_BASE_URL/print-jobs"

# Test 3: Get print jobs with filters
curl "YOUR_BASE_URL/print-jobs?startDate=2025-11-01&status=Completed"

# Test 4: Get statistics
curl "YOUR_BASE_URL/print-jobs/stats"

# Test 5: Get trip summary
curl "YOUR_BASE_URL/trips/summary"
```

---

## ✅ Verification Checklist

After setup, verify:

- [ ] Module created: `wms_api`
- [ ] Base path: `/wms/v1/`
- [ ] 8 GET endpoints created
- [ ] Each endpoint tested in APEX (Test button works)
- [ ] Base URL copied and saved
- [ ] cURL test successful

---

## 🚨 Troubleshooting

### Error: "PLS-00201: identifier must be declared"

**Problem:** Procedure doesn't exist

**Solution:** Run the procedure scripts:
```sql
@02_post_procedures.sql
@03_get_procedures.sql
```

### Error: "ORA-00942: table or view does not exist"

**Problem:** Tables don't exist

**Solution:** Run the table creation script:
```sql
@01_create_tables.sql
```

### Error: No data returned (empty items array)

**Problem:** No data in tables

**Solution:** Run test data script:
```sql
@05_test_data.sql
```

### Can't find the module in APEX

**Problem:** Module not published or wrong workspace

**Solution:**
1. Make sure you're in the correct workspace
2. Check if module is published (toggle at top of module page)

---

## 📚 Quick Reference

| Endpoint | URI Template | Parameters |
|----------|-------------|------------|
| Printer Config | `config/printer` | None |
| All Print Jobs | `print-jobs` | startDate, endDate, status (query) |
| Statistics | `print-jobs/stats` | startDate, endDate (query) |
| Trip Configs | `trips/configs` | startDate, endDate, enabledOnly (query) |
| Trip Summary | `trips/summary` | startDate, endDate (query) |
| Trip Jobs | `trips/:tripId/:tripDate/jobs` | tripId, tripDate (URI) |
| Failed Jobs | `print-jobs/failed` | tripId, tripDate (query) |
| Job History | `print-jobs/:jobId/history` | jobId (URI) |

---

## 📝 Next Steps

After GET endpoints are working:

1. ✅ Test all endpoints with sample data
2. ⏳ Create POST endpoints (for updates)
3. ⏳ Update C# code to call APEX APIs
4. ⏳ Update JavaScript to use APEX endpoints
5. ⏳ Add authentication/security if needed

---

**Need help?** Check:
- `GET_ENDPOINTS_CODE.sql` - All code snippets
- `06_testing_guide.sql` - SQL testing examples
- `FIXES.md` - Common issues and solutions

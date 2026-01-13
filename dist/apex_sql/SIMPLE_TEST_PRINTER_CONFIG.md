# Simple Test - Printer Config Endpoint

This is the simplest possible GET endpoint to test APEX REST API.

---

## 🎯 Step-by-Step Setup (5 Minutes)

### Step 1: Login to APEX
1. Open your APEX URL
2. Login with your credentials
3. Go to **SQL Workshop** → **RESTful Services**

---

### Step 2: Create Module

Click **Create Module** button and fill in:

```
Module Name:  wms_api
Base Path:    /wms/v1/
Protected:    No
```

Click **Create Module**

---

### Step 3: Create Resource Template

1. Click on your module **wms_api**
2. Click **Create Template** button
3. Fill in:
   ```
   URI Template:  config/printer
   ```
   (Don't include leading slash)
4. Click **Create Template**

---

### Step 4: Create GET Handler

1. Click on the template **config/printer**
2. Click **Create Handler** button
3. Fill in the form:

```
Method:         GET
Source Type:    PL/SQL
Requires Secure Access: No
```

4. **In the Source field, paste this code:**

```sql
BEGIN
    wms_get_printer_config(p_cursor => :cursor);
END;
```

5. Scroll down to **Pagination Size**: Enter `25`

6. Click **Create Handler**

---

### Step 5: Test in APEX

1. You should now see the GET handler
2. Click **Test** button (top right corner)
3. Look at the **Results** section at the bottom

**Expected Output:**
```json
{
  "items": [
    {
      "config_id": 1,
      "printer_name": "Microsoft Print to PDF",
      "paper_size": "A4",
      "orientation": "Portrait",
      "fusion_instance": "TEST",
      "fusion_username": "shaik",
      "fusion_password": "fusion1234",
      "auto_download": "Y",
      "auto_print": "Y",
      "is_active": "Y",
      "created_date": "2025-11-05T10:30:00Z",
      "modified_date": null
    }
  ],
  "hasMore": false,
  "limit": 25,
  "offset": 0,
  "count": 1
}
```

✅ **If you see this JSON, it's working!**

---

### Step 6: Get Your REST API URL

1. Click on your module name **wms_api** (in the breadcrumb at top)
2. Look for the **Full URL** shown on the page

Example:
```
https://apex.oracle.com/pls/apex/yourworkspace/wms/v1/
```

Your printer config endpoint URL will be:
```
https://apex.oracle.com/pls/apex/yourworkspace/wms/v1/config/printer
```

---

### Step 7: Test with Browser

1. Copy your full URL from Step 6
2. Open a new browser tab
3. Paste the URL
4. Press Enter

You should see the JSON response in your browser!

---

### Step 8: Test with cURL

Open command line and run:

```bash
curl "https://apex.oracle.com/pls/apex/yourworkspace/wms/v1/config/printer"
```

Replace with your actual URL from Step 6.

---

## 🚨 Troubleshooting

### Error: "wrong number or types of arguments"

**Problem:** Procedure doesn't exist or has different signature

**Solution:** Run these in SQL:
```sql
-- Check if procedure exists
SELECT object_name, object_type, status
FROM user_objects
WHERE object_name = 'WMS_GET_PRINTER_CONFIG';

-- If it doesn't exist, run:
@03_get_procedures.sql
```

---

### Error: "table or view does not exist"

**Problem:** Tables not created

**Solution:** Run this in SQL:
```sql
@01_create_tables.sql
```

---

### Empty items array: `{"items": []}`

**Problem:** No data in table

**Solution:** Run this in SQL:
```sql
@05_test_data.sql
```

Or insert data manually:
```sql
INSERT INTO wms_printer_config (
    printer_name, fusion_instance, fusion_username,
    fusion_password, auto_download, auto_print, is_active
) VALUES (
    'Test Printer', 'TEST', 'testuser',
    'testpass', 'Y', 'Y', 'Y'
);
COMMIT;
```

---

### Can't find RESTful Services menu

**Problem:** Wrong APEX version or permissions

**Solution:**
- Check APEX version (need 5.0+)
- Check you have developer privileges
- Try: SQL Workshop → Utilities → RESTful Services

---

## ✅ Success Checklist

After completing all steps, you should have:

- [x] Module created: `wms_api`
- [x] Resource Template: `config/printer`
- [x] GET Handler created
- [x] Test in APEX shows JSON output
- [x] Browser test shows JSON
- [x] cURL test works
- [x] REST API URL saved

---

## 📝 Summary

**What you created:**
- Module: `wms_api`
- Base Path: `/wms/v1/`
- Endpoint: `config/printer`
- Method: GET

**Code used:**
```sql
BEGIN
    wms_get_printer_config(p_cursor => :cursor);
END;
```

**How it works:**
1. APEX calls your PL/SQL code
2. Code calls `wms_get_printer_config` procedure
3. Procedure returns `SYS_REFCURSOR` to `:cursor`
4. APEX automatically converts cursor → JSON
5. JSON returned to caller

**That's it!** 🎉

---

## 🚀 Next Steps

Once this endpoint works:

1. ✅ Test a few times to make sure it's stable
2. Add more GET endpoints (print-jobs, statistics, etc.)
3. Add POST endpoints (for updates)
4. Update C# code to call this API
5. Update JavaScript to use this API

---

## 📞 Need Help?

If you're stuck, check:
1. Is the procedure created? Run: `SELECT * FROM user_procedures WHERE object_name LIKE 'WMS%';`
2. Is the table created? Run: `SELECT * FROM user_tables WHERE table_name LIKE 'WMS%';`
3. Is there data? Run: `SELECT COUNT(*) FROM wms_printer_config;`

All checks passed but still not working? Share the exact error message!

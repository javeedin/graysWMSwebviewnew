# Postman Testing Guide for APEX REST API

## 🎯 Step-by-Step Postman Setup

### Step 1: Get Your APEX REST URL

First, you need to find your REST API URL in APEX:

1. Login to APEX
2. Go to **SQL Workshop** → **RESTful Services**
3. Click on your module **wms_api**
4. Look at the top of the page - you'll see the **Full URL**

**Example URLs:**
```
https://apex.oracle.com/pls/apex/yourworkspace/wms/v1/
https://g09254cbbf8e7af-db.adb.region.oraclecloudapps.com/ords/workspace/wms/v1/
https://your-apex-instance.com/ords/workspace/wms/v1/
```

**Your printer config endpoint will be:**
```
[YOUR_BASE_URL]/config/printer
```

Example:
```
https://apex.oracle.com/pls/apex/yourworkspace/wms/v1/config/printer
```

---

### Step 2: Open Postman

1. Open Postman application
2. Click **New** → **HTTP Request** (or use the + tab)

---

### Step 3: Configure the Request

**Set these values:**

| Field | Value |
|-------|-------|
| **Method** | GET |
| **URL** | `https://your-apex-url/ords/workspace/wms/v1/config/printer` |
| **Headers** | (Leave default, or see Step 4) |
| **Body** | (Not needed for GET) |
| **Authorization** | No Auth (or see Step 5 if protected) |

---

### Step 4: Set Headers (If Needed)

Click the **Headers** tab:

Add these headers:

| Key | Value |
|-----|-------|
| `Accept` | `application/json` |
| `Content-Type` | `application/json` |

*(These are usually set automatically, but add them if you get errors)*

---

### Step 5: Click SEND

Click the blue **Send** button.

---

## ✅ Expected Response

### **Success (Status 200):**

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
  "count": 1,
  "links": [
    {
      "rel": "self",
      "href": "https://your-apex-url/ords/workspace/wms/v1/config/printer"
    }
  ]
}
```

---

## 🚨 Common Errors & Solutions

### ❌ **Error 1: 404 Not Found**

**What you see in Postman:**
```
Status: 404 Not Found
```

**Possible causes:**
1. Wrong URL
2. Module not published
3. Resource template doesn't exist

**Solutions:**

**A) Check URL is correct:**
```
✅ https://your-apex.com/ords/workspace/wms/v1/config/printer
❌ https://your-apex.com/ords/workspace/wms/v1/printer/config  (wrong order)
❌ https://your-apex.com/ords/workspace/wms/config/printer     (missing /v1/)
```

**B) Check module is published in APEX:**
1. Go to APEX → RESTful Services
2. Click on **wms_api** module
3. Look for a **Published** toggle at the top
4. Make sure it's **ON** (enabled)

**C) Check resource template exists:**
1. Click on **wms_api** module
2. You should see **config/printer** template listed
3. If not, create it again

---

### ❌ **Error 2: 500 Internal Server Error**

**What you see in Postman:**
```json
Status: 500 Internal Server Error
{
  "code": "ORA-00942",
  "message": "table or view does not exist"
}
```

**Solution:** Tables don't exist. Run in SQL:
```sql
@apex_sql/01_create_tables.sql
@apex_sql/05_test_data.sql
```

---

### ❌ **Error 3: Procedure/Function Error**

**What you see in Postman:**
```json
Status: 500 Internal Server Error
{
  "code": "PLS-00201",
  "message": "identifier 'WMS_GET_PRINTER_CONFIG' must be declared"
}
```

**Solution:** Procedure doesn't exist. Run in SQL:
```sql
@apex_sql/03_get_procedures.sql
```

---

### ❌ **Error 4: Empty Items Array**

**What you see in Postman:**
```json
Status: 200 OK
{
  "items": [],
  "hasMore": false,
  "limit": 25,
  "offset": 0,
  "count": 0
}
```

**Solution:** No data in table. Run in SQL:
```sql
@apex_sql/05_test_data.sql
```

Or insert manually:
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

### ❌ **Error 5: Could Not Send Request**

**What you see in Postman:**
```
Could not send request
Error: getaddrinfo ENOTFOUND your-apex-url
```

**Solutions:**

**A) Check internet connection**
- Make sure you're online
- Try opening the URL in a browser first

**B) Check URL format**
- Must start with `https://` or `http://`
- No extra spaces
- No extra slashes at the end

**C) Try in browser first:**
1. Copy your URL
2. Paste in browser address bar
3. Press Enter
4. If it works in browser, copy that exact URL to Postman

---

### ❌ **Error 6: 401 Unauthorized**

**What you see in Postman:**
```
Status: 401 Unauthorized
```

**Solution:** Your APEX REST module is protected with authentication.

**Fix in APEX:**
1. Go to RESTful Services → wms_api module
2. Click **Edit**
3. Set **Protected** to **No**
4. Click **Apply Changes**

OR add authentication in Postman:
1. Click **Authorization** tab
2. Select type (Basic Auth, Bearer Token, etc.)
3. Enter credentials

---

### ❌ **Error 7: CORS Error (in Browser)**

**What you see:**
```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

**Note:** This only happens when calling from JavaScript in a browser, NOT in Postman.

**Solution for later (when using from web app):**
Need to enable CORS in APEX REST module settings.

---

## 🔍 Debugging Steps

If it's not working, follow these steps:

### **Step 1: Test in APEX First**

1. Go to APEX → RESTful Services
2. Click **wms_api** → **config/printer** → **GET**
3. Click **Test** button
4. Does it work here?
   - **YES** → Problem is with Postman URL
   - **NO** → Problem is with APEX setup

---

### **Step 2: Get Exact URL from APEX**

1. In APEX, on the GET handler page
2. Click **Test** button
3. Look at the **Request** section - it shows the exact URL
4. **Copy that exact URL** to Postman

---

### **Step 3: Test in Browser**

1. Copy your URL
2. Open a new browser tab
3. Paste the URL
4. Press Enter
5. Do you see JSON?
   - **YES** → Copy that exact URL to Postman
   - **NO** → APEX endpoint not working

---

### **Step 4: Check APEX Endpoint Status**

Run this in SQL to verify setup:

```sql
-- Check if module exists
SELECT id, name, base_path, status
FROM apex_application_rest_modules
WHERE name = 'wms_api';

-- Check if template exists
SELECT id, uri_template
FROM apex_application_rest_templates
WHERE uri_template LIKE '%printer%';

-- Check if handler exists
SELECT id, method, source
FROM apex_application_rest_handlers
WHERE source LIKE '%wms_get_printer_config%';
```

If any query returns no rows, that component is missing.

---

## 📝 Complete Postman Request Checklist

Before clicking Send, verify:

- [ ] Method is **GET**
- [ ] URL is complete (includes https://, /ords/, /workspace/, /wms/v1/, /config/printer)
- [ ] No trailing slash at the end
- [ ] Module is **Published** in APEX
- [ ] Endpoint tested successfully in APEX first
- [ ] Tables exist and have data
- [ ] Procedure exists

---

## 🎯 Quick Test URL Format

Your URL should match this pattern:

```
https://[apex-host]/ords/[workspace]/wms/v1/config/printer
```

**Examples:**

✅ Good URLs:
```
https://apex.oracle.com/pls/apex/myworkspace/wms/v1/config/printer
https://g09254cbb.adb.region.oraclecloudapps.com/ords/myapp/wms/v1/config/printer
https://mycompany-apex.com/ords/prod/wms/v1/config/printer
```

❌ Bad URLs:
```
https://apex.oracle.com/wms/v1/config/printer              (missing /ords/workspace)
https://apex.oracle.com/ords/myworkspace/config/printer    (missing /wms/v1/)
https://apex.oracle.com/ords/myworkspace/wms/v1/printer    (wrong endpoint)
```

---

## 💡 Pro Tips

### **Tip 1: Save Your Request**

After it works:
1. Click **Save** in Postman
2. Name it: `WMS - Get Printer Config`
3. Create a collection: `WMS API`
4. Save for future use

### **Tip 2: Set Up Environment Variables**

Create a Postman environment:
1. Click **Environments** (left sidebar)
2. Click **+** to create new
3. Name it: `WMS API`
4. Add variable:
   - Variable: `baseUrl`
   - Initial Value: `https://your-apex.com/ords/workspace/wms/v1`

Then in your request URL:
```
{{baseUrl}}/config/printer
```

### **Tip 3: Use Postman Collections**

Organize your requests:
```
WMS API
├─ GET Printer Config
├─ GET Print Jobs
├─ POST Save Printer Config
└─ POST Enable Auto Print
```

---

## 📞 Still Not Working?

**Tell me:**

1. **What's the exact error message** in Postman?
2. **What's the status code** (200, 404, 500, etc.)?
3. **Does the Test button work in APEX?** (Yes/No)
4. **What's your APEX URL format?** (example: apex.oracle.com/pls/apex/...)

Then I can give you specific help! 🚀

# Complete APEX REST Setup Guide - Step by Step

## Problem Summary
- Simple handlers work (Version 1 & 2) ✓
- Handlers with `:body` fail with 555 error ✗
- This indicates `:body` bind variable is not available

## Root Cause
The `:body` bind variable might not be available in your APEX version or REST handler configuration.

---

## Solution: Use Automatic JSON Parsing

APEX can automatically parse JSON from the request body **without** using `:body`.

---

## Complete Setup Steps

### Step 1: Delete Old Handler

1. Go to **SQL Workshop → RESTful Services**
2. Find your module: `rr.endpoints`
3. Find the POST handler
4. **Delete it completely**

### Step 2: Verify Module Settings

1. Click on module: `rr.endpoints`
2. Check settings:
   - **Base Path**: `/rr/endpoints/` (with trailing slash)
   - **Status**: Published
   - **HTTPS Required**: As per your setup
   - **Pagination Size**: Leave default

### Step 3: Check or Create Template

1. Under your module, look for **Resource Templates**
2. If no template exists, create one:
   - **URI Template**: (leave blank or enter `/`)
3. If template exists, click on it

### Step 4: Create New POST Handler

1. Under the template, click **Create Handler**
2. Configure:
   - **Method**: POST
   - **Source Type**: PL/SQL
   - **Requires Secure Access**: As per your setup
   - **MIME Types Allowed**: `application/json`

3. **Source Code**: Paste this:

```sql
DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code    => APEX_JSON.get_varchar2(p_path => 'module_code'),
        p_feature_name   => APEX_JSON.get_varchar2(p_path => 'feature_name'),
        p_http_method    => APEX_JSON.get_varchar2(p_path => 'http_method'),
        p_workspace_url  => APEX_JSON.get_varchar2(p_path => 'workspace_url'),
        p_endpoint_path  => APEX_JSON.get_varchar2(p_path => 'endpoint_path'),
        p_page_name      => APEX_JSON.get_varchar2(p_path => 'page_name'),
        p_workspace_id   => APEX_JSON.get_number(p_path => 'workspace_id'),
        p_description    => APEX_JSON.get_varchar2(p_path => 'description'),
        p_is_active      => NVL(APEX_JSON.get_varchar2(p_path => 'is_active'), 'Y'),
        p_created_by     => NVL(APEX_JSON.get_number(p_path => 'created_by'), 1),
        p_endpoint_id    => v_endpoint_id,
        p_status         => v_status,
        p_message        => v_message
    );

    APEX_JSON.open_object;
    APEX_JSON.write('status', v_status);
    APEX_JSON.write('message', v_message);

    IF v_status = 'SUCCESS' THEN
        APEX_JSON.open_object('data');
        APEX_JSON.write('endpoint_id', v_endpoint_id);
        APEX_JSON.close_object;
    ELSE
        APEX_JSON.write('data', NULL);
    END IF;

    APEX_JSON.close_object;

EXCEPTION
    WHEN OTHERS THEN
        APEX_JSON.open_object;
        APEX_JSON.write('status', 'ERROR');
        APEX_JSON.write('message', SQLERRM);
        APEX_JSON.close_object;
END;
```

4. Click **Create Handler**

### Step 5: Important - Check Handler Settings

After creating the handler:

1. Click on the POST handler you just created
2. Go to **Request** section
3. Make sure:
   - **Source Type**: Request Body (JSON)
   - **Access Method**: Public (or as per your security)

### Step 6: Test

**Postman Settings:**
```
Method: POST
URL: https://apex.oracle.com/pls/apex/grays/rr/endpoints/
Headers:
  Content-Type: application/json
Body (raw JSON):
{
  "module_code": "GL",
  "feature_name": "Test Endpoint",
  "http_method": "GET",
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/test",
  "created_by": 1
}
```

**Expected Response:**
```json
{
  "status": "SUCCESS",
  "message": "Endpoint created successfully with ID: 5",
  "data": {
    "endpoint_id": 5
  }
}
```

---

## If Still Getting 555 Error

### Check APEX Version

Run this in SQL Commands:
```sql
SELECT *
FROM APEX_RELEASE;
```

If APEX version is below 19.1, the automatic JSON parsing might not work.

### Alternative: Use ORDS REST APIs

If APEX REST services are problematic, you can use ORDS directly:

1. Go to **SQL Workshop → RESTful Services**
2. Look for "Enable ORDS" or similar
3. Use ORDS REST Data Services instead of APEX REST

### Check APEX Logs

1. In APEX, go to **SQL Workshop → RESTful Services**
2. Click on your module
3. Look for **Logs** or **Activity Log**
4. Check for any error messages

---

## Troubleshooting Checklist

- [ ] APEX module status is "Published" (not Draft)
- [ ] Handler method is POST (not GET)
- [ ] Handler source type is PL/SQL (not SQL)
- [ ] MIME Types Allowed includes "application/json"
- [ ] Content-Type header in Postman is "application/json"
- [ ] URL is correct (check base path)
- [ ] Package RR_APEX_ENDPOINT_PKG compiles successfully
- [ ] No `:body` variable in handler code
- [ ] No manual APEX_JSON.parse() call

---

## Key Difference in This Approach

**Old (doesn't work):**
```sql
v_body := :body;              -- ✗ :body not available
APEX_JSON.parse(v_body);      -- ✗ Manual parsing
```

**New (should work):**
```sql
-- No :body needed!
-- APEX automatically parses JSON when Content-Type is application/json
APEX_JSON.get_varchar2(p_path => 'module_code')  -- ✓ Direct access
```

---

## Test the Handler

After following all steps above:

1. **First** verify simple version still works:
```sql
BEGIN
    APEX_JSON.open_object;
    APEX_JSON.write('test', 'working');
    APEX_JSON.close_object;
END;
```

2. **Then** use the full handler code

---

## Alternative If Nothing Works

If APEX REST continues to have issues, we can:

1. Create a simple APEX page as an endpoint
2. Use APEX Process to handle the request
3. Return JSON via `apex_json` in the page process

Or:

1. Use a standalone PL/SQL procedure
2. Call it via SQL*Plus or SQL Developer
3. Integrate with application differently

Let me know which approach you'd like to try.
